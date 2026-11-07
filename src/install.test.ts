import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, lstat, readlink, access, readdir, rename, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { syncFiles, flatDirectoryHandler, installProvider, type FileItems, type FilesPaths, type FilesState } from "./install.ts";
import { bootstrap, type Provider } from "./di/index.ts";
import { hashPath } from "./hash.ts";
import type { TargetHandler } from "./registry.ts";
import type { DesiredItem, Plan } from "./plan.ts";

const interop: FilesPaths = { skills: ".agents/skills", agents: ".agents/agents" };

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "agents-config-install-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function makeSourceSkill(root: string, name: string, content: string): Promise<string> {
  const dir = join(root, "src", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), content);
  return dir;
}

function skillPlan(...items: DesiredItem[]): Plan {
  return { skills: items, agents: [], replacements: [] };
}

function skill(name: string, sourcePath: string, repo = "owner/repo"): DesiredItem {
  return { name, sourcePath, origin: { repo, ref: "main" } };
}

const FOO = join(".agents", "skills", "foo");

test("managed ignores preserve foreign text and independent targets, including retained modifications", async () => {
  await withTmpDir(async (project) => {
    const dir = join(project, ".agents", "skills");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ".gitignore"), "# hand written\nlocal\n");
    const one: FilesState = {};
    const two: FilesState = {};
    const a = await makeSourceSkill(project, "first", "a");
    const b = await makeSourceSkill(project, "second", "b");
    await syncFiles(project, interop, skillPlan(skill("first", a)), "copy", one, "one", true);
    await syncFiles(project, interop, skillPlan(skill("second", b)), "copy", two, "two", true);
    await writeFile(join(dir, "first", "SKILL.md"), "modified");
    await syncFiles(project, interop, skillPlan(), "copy", one, "one", true);
    assert.match(await readFile(join(dir, ".gitignore"), "utf8"), /\/first\n/);
    await syncFiles(project, interop, skillPlan(), "copy", two, "two", true);
    const remaining = await readFile(join(dir, ".gitignore"), "utf8");
    assert.ok(remaining.startsWith("# hand written\nlocal\n"));
    assert.match(remaining, /\/first\n/);
    assert.doesNotMatch(remaining, /\/second\n/);
    await rm(join(dir, "first"), { recursive: true });
    await syncFiles(project, interop, skillPlan(), "copy", one, "one", true);
    assert.equal(await readFile(join(dir, ".gitignore"), "utf8"), "# hand written\nlocal\n");
  });
});

test("managed ignore patterns are literal and do not ignore their own file", async () => {
  await withTmpDir(async (project) => {
    const git = promisify(execFile);
    await git("git", ["init", "-q"], { cwd: project });
    const name = "#a [b]*?! ";
    const source = await makeSourceSkill(project, "source", "content");
    await syncFiles(project, interop, skillPlan(skill(name, source)), "copy", {}, "literal", true);
    const dir = join(project, ".agents", "skills");
    await git("git", ["check-ignore", "--", join(dir, name)], { cwd: project });
    await assert.rejects(git("git", ["check-ignore", "--", join(dir, ".gitignore")], { cwd: project }));
    await assert.rejects(git("git", ["check-ignore", "--", join(dir, "#a bZZ! ")], { cwd: project }));
  });
});

test("user negations after a managed block take precedence and remain in place", async () => {
  await withTmpDir(async (project) => {
    const git = promisify(execFile);
    await git("git", ["init", "-q"], { cwd: project });
    const source = await makeSourceSkill(project, "foo", "content");
    const state: FilesState = {};
    await syncFiles(project, interop, skillPlan(skill("foo", source)), "copy", state, "target", true);
    const ignore = join(project, ".agents", "skills", ".gitignore");
    await writeFile(ignore, (await readFile(ignore, "utf8")) + "!/foo\n");
    await syncFiles(project, interop, skillPlan(skill("foo", source)), "copy", state, "target", true);
    assert.match(await readFile(ignore, "utf8"), /!\/foo\n$/);
    await assert.rejects(git("git", ["check-ignore", "--", join(project, FOO)], { cwd: project }));
  });
});

test("failed ignore updates retain retry state and refuse malformed blocks", async () => {
  await withTmpDir(async (project) => {
    const dir = join(project, ".agents", "skills");
    await mkdir(dir, { recursive: true });
    const ignore = join(dir, ".gitignore");
    await writeFile(ignore, "# BEGIN agents-config MANAGED BLOCK (dGFyZ2V0)\nforeign\n");
    const state: FilesState = {};
    const source = await makeSourceSkill(project, "foo", "content");
    await assert.rejects(syncFiles(project, interop, skillPlan(skill("foo", source)), "copy", state, "target", true), /malformed/);
    assert.ok(state.installs?.[FOO]);
    assert.ok(state.managedIgnoreDirs?.length);
    assert.equal(await readFile(ignore, "utf8"), "# BEGIN agents-config MANAGED BLOCK (dGFyZ2V0)\nforeign\n");
    await writeFile(ignore, "foreign\n");
    await syncFiles(project, interop, skillPlan(skill("foo", source)), "copy", state, "target", true);
    assert.equal(state.ignorePending, undefined);
    assert.deepEqual(state.managedIgnoreDirs, [".agents/skills"]);
    assert.match(await readFile(ignore, "utf8"), /\/foo\n/);
  });
});

test("managed ignore synchronization refuses malformed blocks for any target without changing text", async () => {
  await withTmpDir(async (project) => {
    const dir = join(project, ".agents", "skills");
    await mkdir(dir, { recursive: true });
    const ignore = join(dir, ".gitignore");
    const source = await makeSourceSkill(project, "foo", "content");
    const state: FilesState = {};
    await syncFiles(project, interop, skillPlan(skill("foo", source)), "copy", state, "target", true);
    const a = "dGFyZ2V0";
    const b = "b3RoZXI";
    const begin = (id: string) => `# BEGIN agents-config MANAGED BLOCK (${id})\n`;
    const end = (id: string) => `# END agents-config MANAGED BLOCK (${id})\n`;
    const cases = [
      begin(a) + begin(b) + end(b) + end(a),
      begin(a) + begin(b) + end(a) + end(b),
      begin(b) + end(b) + begin(b) + end(b),
      begin(b),
      end(b),
      begin(b) + end(a),
    ];
    for (const text of cases) {
      await writeFile(ignore, text);
      await assert.rejects(syncFiles(project, interop, skillPlan(skill("foo", source)), "copy", state, "target", true), /malformed/);
      assert.equal(await readFile(ignore, "utf8"), text);
      assert.ok(state.managedIgnoreDirs?.length);
    }
  });
});

test("ignore management skips symlink ancestors, outside directories and symlink ignore files", async () => {
  await withTmpDir(async (root) => {
    const project = join(root, "project");
    const outside = join(root, "outside");
    await mkdir(project);
    await mkdir(outside);
    await symlink(outside, join(project, "linked"));
    const source = await makeSourceSkill(project, "source", "content");
    const state: FilesState = {};
    const result = await syncFiles(project, { skills: "linked", agents: "linked" }, skillPlan(skill("foo", source)), "copy", state, "target", true);
    assert.match(result.warnings[0]!, /skipped.*symlink/);
    assert.equal(await pathExists(join(outside, ".gitignore")), false);
    assert.ok(state.ignorePending?.includes("linked"));

    const outsideResult = await syncFiles(project, { skills: "../outside", agents: "../outside" }, skillPlan(skill("bar", source)), "copy", {}, "other", true);
    assert.match(outsideResult.warnings[0]!, /outside project/);
    assert.equal(await pathExists(join(outside, ".gitignore")), false);

    const local = join(project, "local");
    await mkdir(local);
    const foreign = join(root, "foreign-ignore");
    await writeFile(foreign, "untouched\n");
    await symlink(foreign, join(local, ".gitignore"));
    const result2 = await syncFiles(project, { skills: "local", agents: "local" }, skillPlan(skill("foo", source)), "copy", {}, "third", true);
    assert.match(result2.warnings[0]!, /symlink/);
    assert.equal(await readFile(foreign, "utf8"), "untouched\n");
  });
});

test("foreign-only destinations do not create ignore files or pending state", async () => {
  await withTmpDir(async (project) => {
    const dir = join(project, ".agents", "skills", "foo");
    await mkdir(dir, { recursive: true });
    const source = await makeSourceSkill(project, "source", "content");
    const state: FilesState = {};
    const result = await syncFiles(project, interop, skillPlan(skill("foo", source)), "copy", state, "target", true);
    assert.deepEqual(result.skippedForeign, [FOO]);
    assert.deepEqual(state, {});
    assert.equal(await pathExists(join(project, ".agents", "skills", ".gitignore")), false);
  });
});

test("disabled ignore management neither reads nor writes ignore files or records bookkeeping", async () => {
  await withTmpDir(async (project) => {
    const dir = join(project, ".agents", "skills");
    await mkdir(dir, { recursive: true });
    const ignore = join(dir, ".gitignore");
    const content = "# user content\n";
    await writeFile(ignore, content);
    const source = await makeSourceSkill(project, "foo", "content");
    const state: FilesState = {};
    await syncFiles(project, interop, skillPlan(skill("foo", source)), "copy", state, "target", false);
    assert.equal(await readFile(ignore, "utf8"), content);
    assert.equal(state.managedIgnoreDirs, undefined);
    assert.equal(state.ignorePending, undefined);
  });
});

test("disabled ignore management does not parse malformed gitignore content", async () => {
  await withTmpDir(async (project) => {
    const dir = join(project, ".agents", "skills");
    await mkdir(dir, { recursive: true });
    const ignore = join(dir, ".gitignore");
    const malformed = "# BEGIN agents-config MANAGED BLOCK (bad)\n";
    await writeFile(ignore, malformed);
    const source = await makeSourceSkill(project, "foo", "content");
    await syncFiles(project, interop, skillPlan(skill("foo", source)), "copy", {}, "target", false);
    assert.equal(await readFile(ignore, "utf8"), malformed);
  });
});

test("preexisting ignorePending directories are reconciled and cleared", async () => {
  await withTmpDir(async (project) => {
    const dir = join(project, ".agents", "skills");
    await mkdir(dir, { recursive: true });
    const ignore = join(dir, ".gitignore");
    await writeFile(ignore, "# BEGIN agents-config MANAGED BLOCK (dGFyZ2V0)\n/foo\n# END agents-config MANAGED BLOCK (dGFyZ2V0)\n");
    const state: FilesState = { ignorePending: [".agents/skills"] };
    await syncFiles(project, interop, skillPlan(), "copy", state, "target", true);
    assert.equal(await readFile(ignore, "utf8"), "");
    assert.deepEqual(state, {});
  });
});

test("simultaneous install and ignore errors preserve both causes", async () => {
  await withTmpDir(async (project) => {
    const state: FilesState = {};
    const source = await makeSourceSkill(project, "foo", "content");
    await syncFiles(project, interop, skillPlan(skill("foo", source)), "copy", state, "target", true);
    await writeFile(join(project, ".agents", "skills", ".gitignore"), "# BEGIN agents-config MANAGED BLOCK (dGFyZ2V0)\n");
    await assert.rejects(
      syncFiles(project, interop, skillPlan(skill("foo", join(project, "missing"))), "copy", state, "target", true),
      (error: unknown) => error instanceof AggregateError && error.errors.length === 2 &&
        (error.errors[0] as NodeJS.ErrnoException).code === "ENOENT" && /malformed/.test(String(error.errors[1]))
    );
    assert.ok(state.ignorePending?.length);
  });
});

test("syncFiles (copy): installs into the target and records winners and the concrete path", async () => {
  await withTmpDir(async (project) => {
    const src = await makeSourceSkill(project, "foo", "v1");
    const lock: FilesState = {};

    const result = await syncFiles(project, interop, skillPlan(skill("foo", src)), "copy", lock);

    assert.deepEqual(result.added, [FOO]);
    assert.equal(await readFile(join(project, FOO, "SKILL.md"), "utf-8"), "v1");
    assert.equal(lock.installs?.[FOO]?.kind, "skills");
    assert.equal(lock.installs?.[FOO]?.method, "copy");
    assert.notEqual(lock.installs?.[FOO]?.contentHash, "");
  });
});

test("syncFiles (copy): re-running with unchanged content is a no-op", async () => {
  await withTmpDir(async (project) => {
    const src = await makeSourceSkill(project, "foo", "v1");
    const lock: FilesState = {};
    await syncFiles(project, interop, skillPlan(skill("foo", src)), "copy", lock);
    const second = await syncFiles(project, interop, skillPlan(skill("foo", src)), "copy", lock);

    assert.deepEqual(second.added, []);
    assert.deepEqual(second.updated, []);
    assert.deepEqual(second.unchanged, [FOO]);
  });
});

test("syncFiles (copy): changed content updates in place and preserves installedAt", async () => {
  await withTmpDir(async (project) => {
    const src = await makeSourceSkill(project, "foo", "v1");
    const lock: FilesState = {};
    await syncFiles(project, interop, skillPlan(skill("foo", src)), "copy", lock);
    const installedAt = lock.installs?.[FOO]?.installedAt;

    await writeFile(join(src, "SKILL.md"), "v2");
    const result = await syncFiles(project, interop, skillPlan(skill("foo", src)), "copy", lock);

    assert.deepEqual(result.updated, [FOO]);
    assert.equal(await readFile(join(project, FOO, "SKILL.md"), "utf-8"), "v2");
    assert.equal(lock.installs?.[FOO]?.installedAt, installedAt);
  });
});

test("syncFiles (copy): restores desired managed content that was deleted or locally modified", async () => {
  await withTmpDir(async (project) => {
    const src = await makeSourceSkill(project, "foo", "v1");
    const lock: FilesState = {};
    await syncFiles(project, interop, skillPlan(skill("foo", src)), "copy", lock);

    await rm(join(project, FOO), { recursive: true });
    assert.deepEqual((await syncFiles(project, interop, skillPlan(skill("foo", src)), "copy", lock)).updated, [FOO]);

    await writeFile(join(project, FOO, "SKILL.md"), "local change");
    assert.deepEqual((await syncFiles(project, interop, skillPlan(skill("foo", src)), "copy", lock)).updated, [FOO]);
    assert.equal(await readFile(join(project, FOO, "SKILL.md"), "utf-8"), "v1");
  });
});

test("syncFiles (copy): prunes lock-owned paths that are no longer desired", async () => {
  await withTmpDir(async (project) => {
    const src = await makeSourceSkill(project, "foo", "v1");
    const lock: FilesState = {};
    await syncFiles(project, interop, skillPlan(skill("foo", src)), "copy", lock);

    const result = await syncFiles(project, interop, skillPlan(), "copy", lock);

    assert.deepEqual(result.removed, [FOO]);
    assert.equal(await pathExists(join(project, FOO)), false);
    assert.deepEqual(lock, {});
  });
});

test("syncFiles (copy): an undesired path modified since install is left in place and stays owned", async () => {
  await withTmpDir(async (project) => {
    const src = await makeSourceSkill(project, "foo", "v1");
    const lock: FilesState = {};
    await syncFiles(project, interop, skillPlan(skill("foo", src)), "copy", lock);
    await writeFile(join(project, FOO, "SKILL.md"), "local change");

    const result = await syncFiles(project, interop, skillPlan(), "copy", lock);

    assert.deepEqual(result.keptModified, [FOO]);
    assert.deepEqual(result.removed, []);
    assert.equal(await readFile(join(project, FOO, "SKILL.md"), "utf-8"), "local change");
    assert.ok(lock.installs?.[FOO]);

    // Once the user deletes it themselves, the record is dropped.
    await rm(join(project, FOO), { recursive: true });
    const after = await syncFiles(project, interop, skillPlan(), "copy", lock);
    assert.deepEqual(after.removed, [FOO]);
    assert.deepEqual(lock, {});
  });
});

test("syncFiles: leaves a foreign (non-lock-owned) path untouched and reports it", async () => {
  await withTmpDir(async (project) => {
    await mkdir(join(project, FOO), { recursive: true });
    await writeFile(join(project, FOO, "SKILL.md"), "hand-authored");
    const src = await makeSourceSkill(project, "foo", "from-dependency");
    const lock: FilesState = {};

    const result = await syncFiles(project, interop, skillPlan(skill("foo", src)), "copy", lock);

    assert.deepEqual(result.skippedForeign, [FOO]);
    assert.deepEqual(result.added, []);
    assert.equal(await readFile(join(project, FOO, "SKILL.md"), "utf-8"), "hand-authored");
    assert.deepEqual(lock, {});
  });
});

test("syncFiles (link): creates, keeps, and replaces absolute links to a source outside the project, and prunes them", async () => {
  await withTmpDir(async (root) => {
    const project = join(root, "project");
    await mkdir(project);
    const src = await makeSourceSkill(root, "foo", "v1");
    const lock: FilesState = {};

    assert.deepEqual((await syncFiles(project, interop, skillPlan(skill("foo", src)), "link", lock)).added, [FOO]);
    assert.equal((await lstat(join(project, FOO))).isSymbolicLink(), true);
    assert.equal(await readlink(join(project, FOO)), src);
    assert.equal(lock.installs?.[FOO]?.method, "link");

    assert.deepEqual((await syncFiles(project, interop, skillPlan(skill("foo", src)), "link", lock)).unchanged, [FOO]);

    const other = await makeSourceSkill(root, "foo-v2", "v2");
    assert.deepEqual((await syncFiles(project, interop, skillPlan(skill("foo", other)), "link", lock)).updated, [FOO]);
    assert.equal(await readlink(join(project, FOO)), other);

    assert.deepEqual((await syncFiles(project, interop, skillPlan(), "link", lock)).removed, [FOO]);
    assert.equal(await pathExists(join(project, FOO)), false);
    assert.equal(await pathExists(other), true);
  });
});

test("syncFiles: a single-file agent keeps its extension on the installed path", async () => {
  await withTmpDir(async (project) => {
    await mkdir(join(project, "src"), { recursive: true });
    const agentFile = join(project, "src", "bar.md");
    await writeFile(agentFile, "# bar agent");
    const lock: FilesState = {};

    const plan: Plan = { skills: [], agents: [skill("bar", agentFile)], replacements: [] };
    const result = await syncFiles(project, interop, plan, "copy", lock);

    const installed = join(".agents", "agents", "bar.md");
    assert.deepEqual(result.added, [installed]);
    assert.equal(await readFile(join(project, installed), "utf-8"), "# bar agent");
    assert.equal(lock.installs?.[installed]?.kind, "agents");
  });
});

test("syncFiles: creates no directories when nothing is desired and nothing was installed", async () => {
  await withTmpDir(async (project) => {
    const lock: FilesState = {};
    await syncFiles(project, interop, skillPlan(), "copy", lock);
    assert.deepEqual(await readdir(project), []);
  });
});

test("flatDirectoryHandler uses its own defaults for absent or null paths, and config values otherwise", async () => {
  const handler = flatDirectoryHandler({ skills: ".x/skills", agents: ".x/agents" });
  await withTmpDir(async (project) => {
    const src = await makeSourceSkill(project, "foo", "v1");
    const run = (options: Record<string, unknown>) =>
      handler.sync({
        projectDir: project,
        targetName: "x",
        enabled: true,
        options,
        plan: skillPlan(skill("foo", src)),
        installMethod: "copy",
        manageGitignore: true,
        state: {},
      });

    assert.deepEqual((await run({})).added, [join(".x", "skills", "foo")]);
    // null means the default again: the same path, now untracked by this fresh state.
    assert.match((await run({ paths: { skills: null } })).warnings[0] ?? "", /^\.x\/skills\/foo already exists/);
    assert.deepEqual((await run({ paths: { skills: "mine" } })).added, [join("mine", "foo")]);
  });
});

test("flatDirectoryHandler rejects malformed paths before anything runs, and reports foreign paths as warnings", async () => {
  const handler = flatDirectoryHandler({ skills: ".x/skills", agents: ".x/agents" });
  assert.throws(
    () => handler.validate?.({ name: "mine", handler: "x", options: { paths: { agents: 3 } } }),
    /Target 'mine': paths\.agents must be a non-empty string/
  );
  assert.throws(() => handler.validate?.({ name: "mine", handler: "x", options: { paths: "skills" } }), /paths must be a map/);

  await withTmpDir(async (project) => {
    await mkdir(join(project, ".x", "skills", "foo"), { recursive: true });
    const src = await makeSourceSkill(project, "foo", "v1");
    const state = {};
    const report = await handler.sync({
      projectDir: project,
      targetName: "x",
      enabled: true,
      options: {},
      plan: skillPlan(skill("foo", src)),
      installMethod: "copy",
      manageGitignore: true,
      state,
    });
    const path = join(".x", "skills", "foo");
    assert.deepEqual(report.warnings, [`${path} already exists and isn't tracked by agents-config — left untouched`]);
    assert.deepEqual(state, {});
  });
});

test("syncFiles (link): a source inside the project gets a relative link, so moving the project keeps it working", async () => {
  await withTmpDir(async (root) => {
    const project = join(root, "project");
    const src = await makeSourceSkill(project, "foo", "v1");
    const lock: FilesState = {};
    await syncFiles(project, interop, skillPlan(skill("foo", src)), "link", lock);
    assert.equal(await readlink(join(project, FOO)), join("..", "..", "src", "foo"));

    // Re-running keeps it unchanged rather than rewriting it.
    assert.deepEqual((await syncFiles(project, interop, skillPlan(skill("foo", src)), "link", lock)).unchanged, [FOO]);

    const moved = join(root, "moved");
    await rename(project, moved);
    assert.equal(await readFile(join(moved, FOO, "SKILL.md"), "utf-8"), "v1");
  });
});

describe("interop harness handlers", () => {
  const container = (extra?: Provider) =>
    bootstrap(new Map<string, Provider>([["install", installProvider()], ...(extra ? [["module", extra] as const] : [])]));
  const handler = (name: string) => container().resolve<TargetHandler>(`handler/${name}`);

  /** A project whose .agents/ holds `shared` (skill), `shared-agent.md` and a hand-written `own.md` agent. */
  async function fixture(project: string) {
    const sharedSrc = await makeSourceSkill(project, "shared", "shared");
    const onlySrc = await makeSourceSkill(project, "only-here", "only");
    await mkdir(join(project, ".agents", "skills", "shared"), { recursive: true });
    await writeFile(join(project, ".agents", "skills", "shared", "SKILL.md"), "shared");
    await mkdir(join(project, ".agents", "agents"), { recursive: true });
    await writeFile(join(project, ".agents", "agents", "shared-agent.md"), "# a");
    await writeFile(join(project, ".agents", "agents", "own.md"), "# hand-written");
    await mkdir(join(project, "src"), { recursive: true });
    const agentSrc = join(project, "src", "shared-agent.md");
    await writeFile(agentSrc, "# a");
    const plan: Plan = {
      skills: [skill("shared", sharedSrc), skill("only-here", onlySrc)],
      agents: [skill("shared-agent", agentSrc)],
      replacements: [],
    };
    return plan;
  }

  const ctx = (project: string, plan: Plan, state: object, options: Record<string, unknown> = {}, enabled = true) => ({
    projectDir: project,
    targetName: "t",
    enabled,
    options,
    plan,
    installMethod: "copy" as const,
    manageGitignore: true,
    state: state as Record<string, unknown>,
  });

  test("opencode-interop leaves natively read skills to .agents, installs the rest, and links requested agents only", async () => {
    await withTmpDir(async (project) => {
      const plan = await fixture(project);
      const state = {};
      const report = await handler("opencode-interop").sync(ctx(project, plan, state));

      assert.deepEqual(report.added.sort(), [
        join(".opencode", "agents", "shared-agent.md"),
        join(".opencode", "skills", "only-here"),
      ]);
      assert.equal(await pathExists(join(project, ".opencode", "skills", "shared")), false);
      assert.equal(await pathExists(join(project, ".opencode", "agents", "own.md")), false, "hand-written entries aren't linked");
      assert.equal(
        await readlink(join(project, ".opencode", "agents", "shared-agent.md")),
        join("..", "..", ".agents", "agents", "shared-agent.md")
      );
      assert.equal((await lstat(join(project, ".opencode", "skills", "only-here"))).isSymbolicLink(), false);

      // A requested agent that leaves the interop location is installed as the plain handler would.
      await rm(join(project, ".agents", "agents", "shared-agent.md"));
      const second = await handler("opencode-interop").sync(ctx(project, plan, state));
      assert.deepEqual(second.updated, [join(".opencode", "agents", "shared-agent.md")]);
      assert.equal((await lstat(join(project, ".opencode", "agents", "shared-agent.md"))).isSymbolicLink(), false);

      // Cleanup removes everything it placed.
      await handler("opencode-interop").sync(ctx(project, { skills: [], agents: [], replacements: [] }, state, {}, false));
      assert.deepEqual(state, {});
    });
  });

  test("claude-interop links requested interop entries; with unsupported: install it copies them instead", async () => {
    await withTmpDir(async (project) => {
      const plan = await fixture(project);
      const linked = await handler("claude-interop").sync(ctx(project, plan, {}));
      assert.ok(linked.added.includes(join(".claude", "skills", "shared")));
      assert.equal((await lstat(join(project, ".claude", "skills", "shared"))).isSymbolicLink(), true);
      assert.ok(linked.added.includes(join(".claude", "agents", "shared-agent.md")));
      assert.ok(!linked.added.includes(join(".claude", "agents", "own.md")), "hand-written entries aren't linked");

      await rm(join(project, ".claude"), { recursive: true });
      const copied = await handler("claude-interop").sync(ctx(project, plan, {}, { unsupported: "install" }));
      assert.equal((await lstat(join(project, ".claude", "skills", "shared"))).isSymbolicLink(), false);
      assert.ok(!copied.added.includes(join(".claude", "agents", "own.md")), "hand-written entries aren't copied");
    });
  });

  test("claude-interop neither links nor records interop entries another tool wrote, and drops ones an earlier version tracked", async () => {
    await withTmpDir(async (project) => {
      const plan = await fixture(project);
      await mkdir(join(project, ".agents", "skills", "openspec-propose"), { recursive: true });
      await writeFile(join(project, ".agents", "skills", "openspec-propose", "SKILL.md"), "foreign");

      const fresh: FilesState = {};
      await handler("claude-interop").sync(ctx(project, plan, fresh));
      const foreign = join(".claude", "skills", "openspec-propose");
      assert.equal(await pathExists(join(project, foreign)), false);
      assert.ok(!(foreign in (fresh.installs ?? {})));
      assert.doesNotMatch(await readFile(join(project, ".claude", "skills", ".gitignore"), "utf8"), /openspec/);

      // A lock written by an earlier version still owns the foreign link: it's pruned.
      await rm(join(project, ".claude"), { recursive: true });
      await mkdir(join(project, ".claude", "skills"), { recursive: true });
      await symlink(join("..", "..", ".agents", "skills", "openspec-propose"), join(project, foreign));
      const old: FilesState = {
        installs: { [foreign]: { kind: "skills", name: "openspec-propose", method: "link", contentHash: "", installedAt: "t", updatedAt: "t" } },
      };
      const report = await handler("claude-interop").sync(ctx(project, plan, old));
      assert.deepEqual(report.removed, [foreign]);
      assert.equal(await pathExists(join(project, foreign)), false);
      assert.equal(await pathExists(join(project, ".agents", "skills", "openspec-propose", "SKILL.md")), true, "the source is untouched");
      assert.ok(!(foreign in (old.installs ?? {})));
    });
  });

  test("codex-interop installs agents by default and refuses unsupported: symlink", async () => {
    const codex = handler("codex-interop");
    assert.throws(() => codex.validate?.({ name: "c", handler: "codex-interop", options: { unsupported: "symlink" } }), /isn't possible/);
    assert.throws(() => codex.validate?.({ name: "c", handler: "codex-interop", options: { unsupported: "maybe" } }), /must be "symlink" or "install"/);

    await withTmpDir(async (project) => {
      const plan = await fixture(project);
      const report = await codex.sync(ctx(project, plan, {}));
      assert.deepEqual(report.added, [join(".codex", "skills", "only-here")]);
      assert.deepEqual(report.warnings, ["1 agents not installed: Codex agents are TOML files; converting Markdown agents isn't implemented"]);
      assert.equal(await pathExists(join(project, ".codex", "agents")), false);
    });
  });

  test("codex removes Markdown agents an earlier version installed, and skips requested ones", async () => {
    await withTmpDir(async (project) => {
      const plan = await fixture(project);
      const old = join(".codex", "agents", "shared-agent.md");
      await mkdir(join(project, ".codex", "agents"), { recursive: true });
      await writeFile(join(project, old), "# a");
      const state = {
        installs: { [old]: { kind: "agents", name: "shared-agent", method: "copy", contentHash: await hashPath(join(project, old)), installedAt: "t", updatedAt: "t" } },
      };

      const report = await handler("codex").sync(ctx(project, plan, state));
      assert.deepEqual(report.removed, [old]);
      assert.equal(await pathExists(join(project, old)), false);
      assert.equal(report.warnings.length, 1);
    });
  });

  test("a *-interop handler extends whatever its base handler currently is, and refuses one it can't extend", async () => {
    const calls: unknown[] = [];
    const overridden: Provider = {
      definitions: {
        // A module replacing the claude handler, e.g. with a converting one.
        "handler/claude": () => ({
          sync: async () => ({ added: [], updated: [], removed: [], unchanged: [], warnings: [] }),
          installItems: async (_ctx: unknown, items: FileItems) => {
            calls.push(items.skills.map((i) => i.name));
            return { added: ["custom"], updated: [], removed: [], unchanged: [], warnings: [] };
          },
        }),
        "handler/codex": () => ({ sync: async () => ({ added: [], updated: [], removed: [], unchanged: [], warnings: [] }) }),
      },
    };
    const c = container(overridden);

    await withTmpDir(async (project) => {
      const plan = await fixture(project);
      const report = await c.resolve<TargetHandler>("handler/claude-interop").sync(ctx(project, plan, {}));
      assert.deepEqual(report.added, ["custom"]);
      assert.deepEqual(calls, [["shared", "only-here"]]);
    });

    assert.throws(() => c.resolve("handler/codex-interop"), /'codex' handler can't be extended by 'codex-interop'/);
  });
});
