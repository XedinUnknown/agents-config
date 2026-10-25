import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, access, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bootstrapApp } from "./app.ts";
import { runInstall } from "./run.ts";
import { emptyLock } from "./lockfile.ts";
import type { TargetHandler } from "./registry.ts";

const execFileAsync = promisify(execFile);

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

async function git(args: string[], cwd: string): Promise<void> {
  await execFileAsync("git", args, { cwd, env: gitEnv });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeConfig(configDir: string, yaml: string): Promise<void> {
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, "config.yaml"), yaml, "utf-8");
}

// End-to-end through the same seam `install`/`add` use: a manifest pointing at
// a real (local, no network) git dependency, synced by the default "interop"
// harness into .agents/ relative to cwd. This is the automated version of the
// sandboxed HOME/XDG manual verification described in AGENTS.md. Now goes
// through the full `bootstrapApp` composition, not a hand-built ToolConfig —
// cwd/config dir/cache dir are all passed as explicit bootstrap options
// instead of process.chdir()/env var mutation.
test("run/install syncs a project dependency into .agents/ via the default interop harness, and prunes on removal", async () => {
  const root = await mkdtemp(join(tmpdir(), "agents-config-run-"));
  try {
    const sourceRepo = join(root, "source");
    await mkdir(join(sourceRepo, "skills", "demo-skill"), { recursive: true });
    await writeFile(join(sourceRepo, "skills", "demo-skill", "SKILL.md"), "# demo skill");
    await mkdir(join(sourceRepo, "agents"), { recursive: true });
    await writeFile(join(sourceRepo, "agents", "demo-agent.md"), "# demo agent");

    await git(["init", "-b", "main"], sourceRepo);
    await git(["add", "."], sourceRepo);
    await git(["commit", "-m", "initial"], sourceRepo);

    const projectDir = join(root, "project");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "agents.yaml"), `dependencies:\n  - repo: ${sourceRepo}\n    ref: main\n`);

    const configDir = join(root, "config");
    await writeConfig(configDir, "clone_method: https\ninstall_method: copy\ntargets:\n  interop: true\n");

    const container = bootstrapApp({
      cwd: projectDir,
      env: process.env,
      configDirOverride: configDir,
      cacheDirOverride: join(root, "cache"),
    });
    const install = container.resolve<() => Promise<void>>("run/install");

    await install();

    const skillPath = join(projectDir, ".agents", "skills", "demo-skill", "SKILL.md");
    const agentPath = join(projectDir, ".agents", "agents", "demo-agent.md");
    assert.equal(await pathExists(skillPath), true);
    assert.equal(await pathExists(agentPath), true);

    // Re-running is idempotent — no errors, files remain in place.
    await install();
    assert.equal(await pathExists(skillPath), true);

    // Removing the dependency prunes what this tool installed.
    await writeFile(join(projectDir, "agents.yaml"), "dependencies: []\n");
    await install();
    assert.equal(await pathExists(skillPath), false);
    assert.equal(await pathExists(agentPath), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run/install leaves a hand-authored file with the same name untouched (foreign-file protection)", async () => {
  const root = await mkdtemp(join(tmpdir(), "agents-config-run-foreign-"));
  try {
    const sourceRepo = join(root, "source");
    await mkdir(join(sourceRepo, "skills", "demo-skill"), { recursive: true });
    await writeFile(join(sourceRepo, "skills", "demo-skill", "SKILL.md"), "# from dependency");
    await git(["init", "-b", "main"], sourceRepo);
    await git(["add", "."], sourceRepo);
    await git(["commit", "-m", "initial"], sourceRepo);

    const projectDir = join(root, "project");
    await mkdir(join(projectDir, ".agents", "skills", "demo-skill"), { recursive: true });
    await writeFile(join(projectDir, ".agents", "skills", "demo-skill", "SKILL.md"), "# hand-authored");
    await writeFile(join(projectDir, "agents.yaml"), `dependencies:\n  - repo: ${sourceRepo}\n    ref: main\n    agents: false\n`);

    const configDir = join(root, "config");
    await writeConfig(configDir, "clone_method: https\ninstall_method: copy\ntargets:\n  interop: true\n");

    const container = bootstrapApp({
      cwd: projectDir,
      env: process.env,
      configDirOverride: configDir,
      cacheDirOverride: join(root, "cache"),
    });
    await container.resolve<() => Promise<void>>("run/install")();

    const skillFile = join(projectDir, ".agents", "skills", "demo-skill", "SKILL.md");
    const content = await import("node:fs/promises").then((fs) => fs.readFile(skillFile, "utf-8"));
    assert.equal(content, "# hand-authored");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Regression test for the "no global mode" design: a custom harness like the
// real agents-root (bare "skills"/"agents", used for ~/.agents) reaches its
// fixed location purely by being run from within that directory — the same
// mechanism as any other project, not a separate scope.
test("a custom harness with bare skills/agents paths installs relative to whatever cwd it's run from", async () => {
  const root = await mkdtemp(join(tmpdir(), "agents-config-run-custom-bare-"));
  try {
    const sourceRepo = join(root, "source");
    await mkdir(join(sourceRepo, "skills", "demo-skill"), { recursive: true });
    await writeFile(join(sourceRepo, "skills", "demo-skill", "SKILL.md"), "# demo skill");
    await git(["init", "-b", "main"], sourceRepo);
    await git(["add", "."], sourceRepo);
    await git(["commit", "-m", "initial"], sourceRepo);

    // Stand-in for "~/.agents itself": an agents.yaml living at the bare root.
    const agentsRootDir = join(root, "agents-root-stand-in");
    await mkdir(agentsRootDir, { recursive: true });
    await writeFile(
      join(agentsRootDir, "agents.yaml"),
      `dependencies:\n  - repo: ${sourceRepo}\n    ref: main\n    agents: false\n`
    );

    const configDir = join(root, "config");
    await writeConfig(
      configDir,
      [
        "clone_method: https",
        "install_method: copy",
        "targets:",
        "  agents-root:",
        "    handler: interop",
        "    paths: { skills: skills, agents: agents }",
      ].join("\n") + "\n"
    );

    const container = bootstrapApp({
      cwd: agentsRootDir,
      env: process.env,
      configDirOverride: configDir,
      cacheDirOverride: join(root, "cache"),
    });
    await container.resolve<() => Promise<void>>("run/install")();

    const installed = join(agentsRootDir, "skills", "demo-skill", "SKILL.md");
    assert.equal(await pathExists(installed), true);
    // No "global" location was ever consulted or created.
    assert.equal(await pathExists(join(agentsRootDir, "agents")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function makeSourceRepo(root: string, name: string, skills: Record<string, string>): Promise<string> {
  const repo = join(root, name);
  for (const [skill, content] of Object.entries(skills)) {
    await mkdir(join(repo, "skills", skill), { recursive: true });
    await writeFile(join(repo, "skills", skill, "SKILL.md"), content);
  }
  await git(["init", "-b", "main"], repo);
  await git(["add", "."], repo);
  await git(["commit", "-m", "initial"], repo);
  return repo;
}

function installFor(root: string, projectDir: string) {
  return bootstrapApp({
    cwd: projectDir,
    env: process.env,
    configDirOverride: join(root, "config"),
    cacheDirOverride: join(root, "cache"),
  }).resolve<() => Promise<void>>("run/install");
}

test("run/install merges config.yaml defaults with agents.yaml, the later dependency winning a name collision", async () => {
  const root = await mkdtemp(join(tmpdir(), "agents-config-run-layers-"));
  try {
    const defaults = await makeSourceRepo(root, "defaults", { shared: "# from defaults", "only-default": "# d" });
    const project = await makeSourceRepo(root, "project-dep", { shared: "# from project" });

    await writeConfig(
      join(root, "config"),
      `targets:\n  claude: true\ndependencies:\n  - repo: ${defaults}\n    agents: false\n`
    );
    const projectDir = join(root, "project");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "agents.yaml"), `dependencies:\n  - repo: ${project}\n    agents: false\n`);

    await installFor(root, projectDir)();

    const skills = join(projectDir, ".claude", "skills");
    assert.equal(await readFile(join(skills, "shared", "SKILL.md"), "utf-8"), "# from project");
    assert.equal(await pathExists(join(skills, "only-default", "SKILL.md")), true);
    // config.yaml declared targets, so the interop fallback is not used.
    assert.equal(await pathExists(join(projectDir, ".agents")), false);

    const lock = JSON.parse(await readFile(join(projectDir, "agents-lock.json"), "utf-8"));
    assert.deepEqual(lock.skills.shared, { repo: project, ref: "main" });
    assert.deepEqual(lock.targets.claude.handler, "claude");
    assert.deepEqual(Object.keys(lock.targets.claude.state.installs).sort(), [join(".claude", "skills", "only-default"), join(".claude", "skills", "shared")]);
    // No per-directory locks any more.
    assert.equal(await pathExists(join(skills, "agents-lock.json")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run/install: disabling a target in agents.yaml cleans up what it installed", async () => {
  const root = await mkdtemp(join(tmpdir(), "agents-config-run-disable-"));
  try {
    const source = await makeSourceRepo(root, "source", { demo: "# demo" });
    await writeConfig(join(root, "config"), "targets:\n  interop: true\n  claude: true\n");
    const projectDir = join(root, "project");
    await mkdir(projectDir, { recursive: true });
    const deps = `dependencies:\n  - repo: ${source}\n    agents: false\n`;
    await writeFile(join(projectDir, "agents.yaml"), deps);

    const install = installFor(root, projectDir);
    await install();
    assert.equal(await pathExists(join(projectDir, ".claude", "skills", "demo")), true);

    await writeFile(join(projectDir, "agents.yaml"), `targets:\n  claude: false\n${deps}`);
    await install();
    assert.equal(await pathExists(join(projectDir, ".claude", "skills", "demo")), false);
    assert.equal(await pathExists(join(projectDir, ".agents", "skills", "demo")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run/install with a legacy agents key aborts without touching the project", async () => {
  const root = await mkdtemp(join(tmpdir(), "agents-config-run-legacy-"));
  try {
    await writeConfig(join(root, "config"), "agents: [interop]\n");
    const projectDir = join(root, "project");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "agents.yaml"), "dependencies: []\n");

    await assert.rejects(() => installFor(root, projectDir)(), /use 'targets'/);
    assert.deepEqual(await readdir(projectDir), ["agents.yaml"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run/install aborts before syncing or saving the lock when a dependency cannot be fetched", async () => {
  let synced = false;
  let saved = false;
  await assert.rejects(
    () =>
      runInstall({ targets: { interop: true } }, "/tmp/project", {
        ensureRepo: async () => ({ success: false, path: "/tmp/cache", error: "network unavailable" }),
        discoverSkills: async () => [],
        discoverAgents: async () => [],
        filterItems: () => ({ selected: [], missing: [] }),
        manifestExists: async () => true,
        loadManifest: async () => ({
          dependencies: [{ repo: "owner/repo", ref: "main", skills: "*", agents: false }],
        }),
        loadLock: async () => emptyLock(),
        saveLock: async () => {
          saved = true;
        },
        getHandler: () => ({
          sync: async () => {
            synced = true;
            throw new Error("unreachable");
          },
        }),
      }),
    /Failed to cache owner\/repo: network unavailable/
  );
  assert.equal(synced, false);
  assert.equal(saved, false);
});

// Stand-in for a harness whose install isn't a file drop: it writes one
// registry file listing the requested skills, and deletes it when nothing is
// requested (the target was disabled or removed).
function registryHandler(calls: Array<{ target: string; skills: string[]; state: unknown }>): TargetHandler {
  return {
    validate(target) {
      if (typeof target.options["file"] !== "string") throw new Error("registry handler needs 'file'");
    },
    async sync(ctx) {
      calls.push({ target: ctx.targetName, skills: ctx.plan.skills.map((s) => s.name), state: structuredClone(ctx.state) });
      const report = { added: [] as string[], updated: [], removed: [] as string[], unchanged: [], warnings: [] };
      const previous = ctx.state["file"] as string | undefined;
      if (ctx.plan.skills.length === 0) {
        if (previous) {
          await rm(join(ctx.projectDir, previous), { force: true });
          delete ctx.state["file"];
          report.removed.push(previous);
        }
        return report;
      }
      const file = ctx.options["file"] as string;
      await writeFile(join(ctx.projectDir, file), ctx.plan.skills.map((s) => s.name).join("\n"));
      ctx.state["file"] = file;
      report.added.push(file);
      return report;
    },
  };
}

function installWithModule(root: string, projectDir: string, handler: TargetHandler) {
  return bootstrapApp({
    cwd: projectDir,
    env: process.env,
    configDirOverride: join(root, "config"),
    cacheDirOverride: join(root, "cache"),
    modules: new Map([["my-module", { definitions: { "handler/registry": () => handler } }]]),
  }).resolve<() => Promise<void>>("run/install");
}

async function readLock(projectDir: string) {
  return JSON.parse(await readFile(join(projectDir, "agents-lock.json"), "utf-8"));
}

test("a module adds a handler: it gets the requested skills and its settings, owns its record, and undoes it when disabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "agents-config-run-handler-"));
  try {
    const source = await makeSourceRepo(root, "source", { demo: "# demo" });
    await writeConfig(join(root, "config"), "");
    const projectDir = join(root, "project");
    await mkdir(projectDir, { recursive: true });
    const deps = `dependencies:\n  - repo: ${source}\n    agents: false\n`;
    await writeFile(join(projectDir, "agents.yaml"), `targets:\n  my-harness:\n    handler: registry\n    file: registry.txt\n${deps}`);

    const calls: Array<{ target: string; skills: string[]; state: unknown }> = [];
    const install = installWithModule(root, projectDir, registryHandler(calls));

    await install();
    assert.equal(await readFile(join(projectDir, "registry.txt"), "utf-8"), "demo");
    assert.deepEqual((await readLock(projectDir)).targets, {
      "my-harness": { handler: "registry", state: { file: "registry.txt" } },
    });
    // Only the custom target is enabled, so no built-in handler ran.
    assert.equal(await pathExists(join(projectDir, ".agents")), false);

    await writeFile(join(projectDir, "agents.yaml"), `targets:\n  my-harness: false\n${deps}`);
    await install();
    assert.deepEqual(calls.at(-1), { target: "my-harness", skills: [], state: { file: "registry.txt" } });
    assert.equal(await pathExists(join(projectDir, "registry.txt")), false);
    assert.deepEqual((await readLock(projectDir)).targets, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run/install: renaming a target or switching its handler undoes the old install with the handler that made it", async () => {
  const root = await mkdtemp(join(tmpdir(), "agents-config-run-switch-"));
  try {
    const source = await makeSourceRepo(root, "source", { demo: "# demo" });
    await writeConfig(join(root, "config"), "");
    const projectDir = join(root, "project");
    await mkdir(projectDir, { recursive: true });
    const deps = `dependencies:\n  - repo: ${source}\n    agents: false\n`;
    const calls: Array<{ target: string; skills: string[]; state: unknown }> = [];
    const install = installWithModule(root, projectDir, registryHandler(calls));

    // A custom target reusing the claude handler with its own paths.
    await writeFile(join(projectDir, "agents.yaml"), `targets:\n  mine:\n    handler: claude\n    paths: { skills: s }\n${deps}`);
    await install();
    assert.equal(await pathExists(join(projectDir, "s", "demo", "SKILL.md")), true);

    // Renamed: "mine" is gone from config, so the claude handler removes its install.
    await writeFile(join(projectDir, "agents.yaml"), `targets:\n  ours:\n    handler: claude\n    paths: { skills: t }\n${deps}`);
    await install();
    assert.equal(await pathExists(join(projectDir, "s", "demo")), false);
    assert.equal(await pathExists(join(projectDir, "t", "demo", "SKILL.md")), true);

    // Same target, different handler: claude's install is undone first.
    await writeFile(join(projectDir, "agents.yaml"), `targets:\n  ours:\n    handler: registry\n    file: reg.txt\n${deps}`);
    await install();
    assert.equal(await pathExists(join(projectDir, "t", "demo")), false);
    assert.equal(await readFile(join(projectDir, "reg.txt"), "utf-8"), "demo");
    assert.deepEqual((await readLock(projectDir)).targets, { ours: { handler: "registry", state: { file: "reg.txt" } } });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run/install aborts before changing anything when a target has no handler or its handler rejects its settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "agents-config-run-bad-handler-"));
  try {
    await writeConfig(join(root, "config"), "");
    const projectDir = join(root, "project");
    await mkdir(projectDir, { recursive: true });

    await writeFile(join(projectDir, "agents.yaml"), "targets:\n  bogus: true\n");
    await assert.rejects(() => installFor(root, projectDir)(), /Unknown target 'bogus': there is no 'bogus' handler/);

    await writeFile(join(projectDir, "agents.yaml"), "targets:\n  x:\n    handler: nope\n");
    await assert.rejects(() => installFor(root, projectDir)(), /Target 'x': there is no 'nope' handler/);

    await writeFile(join(projectDir, "agents.yaml"), "targets:\n  claude:\n    paths: { skills: 3 }\n");
    await assert.rejects(() => installFor(root, projectDir)(), /Target 'claude': paths\.skills must be a non-empty string/);

    assert.deepEqual(await readdir(projectDir), ["agents.yaml"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run/install refuses to forget a target's install when the handler that made it is no longer available", async () => {
  const root = await mkdtemp(join(tmpdir(), "agents-config-run-gone-handler-"));
  try {
    await writeConfig(join(root, "config"), "");
    const projectDir = join(root, "project");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "agents.yaml"), "dependencies: []\n");
    const lock = {
      version: 2,
      skills: {},
      agents: {},
      targets: { "my-harness": { handler: "registry", state: { file: "registry.txt" } } },
    };
    await writeFile(join(projectDir, "agents-lock.json"), JSON.stringify(lock));

    await assert.rejects(() => installFor(root, projectDir)(), /Target 'my-harness' was installed by the 'registry' handler/);
    assert.deepEqual(await readLock(projectDir), lock);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
