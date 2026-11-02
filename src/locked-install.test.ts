import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readlink, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { bootstrapApp } from "./app.ts";
import type { LockFile } from "./lockfile.ts";

const exec = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const skill = join(".agents", "skills", "demo", "SKILL.md");

async function fixture(t: TestContext, method: "copy" | "link" = "copy") {
  const root = await mkdtemp(join(tmpdir(), "agents-config-locked-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const config = join(root, "config");
  const cache = join(root, "cache");
  const env = {
    ...process.env,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "xdg-config"),
    XDG_CACHE_HOME: join(root, "xdg-cache"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_ALLOW_PROTOCOL: "file",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  for (const dir of [source, config, env.HOME, env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME]) {
    await mkdir(dir, { recursive: true });
  }
  const git = async (...args: string[]) => (await exec("git", [
    "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args,
  ], { cwd: source, env })).stdout.trim();
  await git("init", "-b", "main");
  const commit = async (content: string) => {
    await mkdir(join(source, "skills", "demo"), { recursive: true });
    await writeFile(join(source, "skills", "demo", "SKILL.md"), content);
    await git("add", ".");
    await git("commit", "-m", content);
    return git("rev-parse", "HEAD");
  };
  const initial = await commit("# old");
  const repo = pathToFileURL(source).href;
  const manifest = `dependencies:\n  - repo: ${repo}\n    ref: main\n    agents: false\n`;
  await writeFile(join(config, "config.yaml"),
    `clone_method: https\ninstall_method: ${method}\ntargets:\n  interop: true\n`);
  const project = async (name = "project", yaml = manifest) => {
    const dir = join(root, name);
    await mkdir(dir);
    await writeFile(join(dir, "agents.yaml"), yaml);
    return dir;
  };
  const run = (cwd: string, command: "install" | "update", cacheDir = cache) => bootstrapApp({
    cwd, env, configDirOverride: config, cacheDirOverride: cacheDir,
  }).resolve<() => Promise<void>>(`run/${command}`)();
  return { root, source, config, cache, env, git, commit, initial, repo, manifest, project, run };
}

async function lockAt(project: string): Promise<LockFile> {
  return JSON.parse(await readFile(join(project, "agents-lock.json"), "utf8"));
}

async function installed(project: string) {
  return readFile(join(project, skill), "utf8");
}

async function unchangedState(project: string) {
  return {
    lock: await readFile(join(project, "agents-lock.json"), "utf8"),
    mtime: (await stat(join(project, "agents-lock.json"), { bigint: true })).mtimeNs,
    content: await installed(project),
  };
}

test("install pins main; update advances the commit and an unchanged update does not rewrite the lock", async (t) => {
  const f = await fixture(t);
  const project = await f.project();
  await f.run(project, "install");
  const first = await lockAt(project);
  assert.deepEqual(first.dependencies, [{
    dependency: { repo: f.repo, ref: "main", skills: "*", agents: false },
    commit: f.initial,
  }]);
  assert.deepEqual(first.skills.demo, { repo: f.repo, ref: "main", commit: f.initial });
  const before = await unchangedState(project);
  const next = await f.commit("# new");

  await f.run(project, "install");
  assert.deepEqual(await unchangedState(project), before);
  await f.run(project, "update");
  assert.equal(await installed(project), "# new");
  assert.notEqual(next, f.initial);
  assert.equal((await lockAt(project)).dependencies?.[0]?.commit, next);
  assert.deepEqual((await lockAt(project)).skills.demo, { repo: f.repo, ref: "main", commit: next });

  // A fixed old timestamp catches rewrites without sleeps or clock-resolution races.
  await utimes(join(project, "agents-lock.json"), new Date(0), new Date(0));
  const updated = await unchangedState(project);
  await f.run(project, "update");
  assert.deepEqual(await unchangedState(project), updated);
});

test("a copied lock installs its old commit into a fresh project and cache after main moves", async (t) => {
  const f = await fixture(t);
  const original = await f.project();
  await f.run(original, "install");
  const locked = await readFile(join(original, "agents-lock.json"), "utf8");
  await f.commit("# new");
  const fresh = await f.project("fresh");
  await writeFile(join(fresh, "agents-lock.json"), locked);
  const freshCache = join(f.root, "fresh-cache");
  await assert.rejects(stat(freshCache), { code: "ENOENT" });

  await f.run(fresh, "install", freshCache);
  assert.equal(await installed(fresh), "# old");
  const restored = await lockAt(fresh);
  const originalLock = await lockAt(original);
  assert.deepEqual(restored.dependencies, originalLock.dependencies);
  assert.deepEqual(restored.skills, originalLock.skills);
});

test("updating a second link-installed project cannot mutate the first project's shared-cache snapshot", async (t) => {
  const f = await fixture(t, "link");
  const first = await f.project("first");
  const second = await f.project("second");
  await f.run(first, "install");
  await f.run(second, "install");
  const link = join(".agents", "skills", "demo");
  const firstTarget = await readlink(join(first, link));
  assert.equal(await readlink(join(second, link)), firstTarget);
  const before = await unchangedState(first);
  const next = await f.commit("# new");

  await f.run(second, "update");
  assert.equal(await installed(second), "# new");
  assert.equal((await lockAt(second)).dependencies?.[0]?.commit, next);
  assert.notEqual(await readlink(join(second, link)), firstTarget);
  assert.equal(await readlink(join(first, link)), firstTarget);
  assert.deepEqual(await unchangedState(first), before);
  await f.run(first, "install");
  assert.equal(await installed(first), "# old");
  assert.equal((await lockAt(first)).dependencies?.[0]?.commit, f.initial);
  assert.equal(await installed(second), "# new");
});

test("a versioned local repository stays pinned on install and advances only on update", async (t) => {
  const f = await fixture(t);
  const project = await f.project();
  await f.run(project, "install");
  assert.deepEqual((await lockAt(project)).dependencies, [{
    dependency: { repo: f.repo, ref: "main", skills: "*", agents: false },
    commit: f.initial,
  }]);
  const before = await unchangedState(project);
  const next = await f.commit("# new");
  await writeFile(join(f.source, "skills", "demo", "SKILL.md"), "# uncommitted");

  await f.run(project, "install");
  assert.deepEqual(await unchangedState(project), before);
  await f.run(project, "update");
  assert.equal(await installed(project), "# new");
  assert.equal((await lockAt(project)).dependencies?.[0]?.commit, next);
  assert.deepEqual((await lockAt(project)).skills.demo,
    { repo: f.repo, ref: "main", commit: next });
});

test("dependency drift rejects install without changing the lock or installed content", async (t) => {
  const f = await fixture(t);
  const project = await f.project();
  await f.run(project, "install");
  const before = await unchangedState(project);
  await writeFile(join(project, "agents.yaml"), "dependencies: []\n");

  await assert.rejects(f.run(project, "install"), /Dependencies differ.*agents-config update/);
  assert.deepEqual(await unchangedState(project), before);
});

test("legacy locks require update, which upgrades resolutions without losing ownership", async (t) => {
  const f = await fixture(t);
  const project = await f.project();
  await f.run(project, "install");
  const legacy = await lockAt(project);
  delete legacy.dependencies;
  legacy.skills.demo = { repo: f.repo, ref: "main" };
  await writeFile(join(project, "agents-lock.json"), JSON.stringify(legacy, null, 2) + "\n");
  const before = await unchangedState(project);
  const next = await f.commit("# new");

  await assert.rejects(f.run(project, "install"), /no pinned dependency resolutions.*agents-config update/);
  assert.deepEqual(await unchangedState(project), before);
  await f.run(project, "update");
  const upgraded = await lockAt(project);
  assert.equal(upgraded.dependencies?.[0]?.commit, next);
  assert.equal(await installed(project), "# new");
  assert.equal(upgraded.targets.interop?.handler, legacy.targets.interop?.handler);
  assert.deepEqual(Object.keys(upgraded.targets.interop!.state), Object.keys(legacy.targets.interop!.state));

  // Pruning the upgraded install proves its concrete path is still lock-owned.
  await writeFile(join(project, "agents.yaml"), "dependencies: []\n");
  await f.run(project, "update");
  await assert.rejects(stat(join(project, skill)), { code: "ENOENT" });
  assert.deepEqual((await lockAt(project)).dependencies, []);
});

test("an unavailable source during update cannot prune installed content or change the lock", async (t) => {
  const f = await fixture(t);
  const project = await f.project();
  await f.run(project, "install");
  const before = await unchangedState(project);
  await rename(f.source, join(f.root, "unavailable-source"));
  // Cleanup would remove the old target if it ran before dependency resolution.
  await writeFile(join(project, "agents.yaml"), `targets:\n  interop: false\n${f.manifest}`);

  await assert.rejects(f.run(project, "update"), /Failed to cache/);
  assert.deepEqual(await unchangedState(project), before);
});

test("real CLI dispatches install/update and reports dependency drift in an isolated environment", async (t) => {
  const f = await fixture(t);
  const project = await f.project();
  const cli = (command: "install" | "update") => exec(process.execPath, [
    join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    join(repositoryRoot, "src", "index.ts"),
    "--config", f.config, "--cache-dir", f.cache, command,
  ], { cwd: project, env: f.env, timeout: 30_000 });

  await cli("install");
  assert.equal(await installed(project), "# old");
  assert.equal((await lockAt(project)).dependencies?.[0]?.commit, f.initial);
  const next = await f.commit("# new");
  await cli("install");
  assert.equal(await installed(project), "# old");
  assert.equal((await lockAt(project)).dependencies?.[0]?.commit, f.initial);
  await cli("update");
  assert.equal(await installed(project), "# new");
  assert.equal((await lockAt(project)).dependencies?.[0]?.commit, next);
  const before = await unchangedState(project);
  await writeFile(join(project, "agents.yaml"), "dependencies: []\n");

  await assert.rejects(cli("install"), (error: unknown) => {
    assert.ok(error instanceof Error && "code" in error && "stderr" in error);
    assert.equal(error.code, 1);
    assert.match(String(error.stderr), /Dependencies differ.*agents-config update/);
    return true;
  });
  assert.deepEqual(await unchangedState(project), before);
  await cli("update");
  await assert.rejects(stat(join(project, skill)), { code: "ENOENT" });
  assert.deepEqual((await lockAt(project)).dependencies, []);
});
