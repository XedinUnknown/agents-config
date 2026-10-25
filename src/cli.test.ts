import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bootstrapApp } from "./app.ts";
import type { AddCommandOptions } from "./cli.ts";

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

function defaultAddOptions(overrides: Partial<AddCommandOptions> = {}): AddCommandOptions {
  return {
    ref: "main",
    skill: [],
    agent: [],
    skills: true,
    agents: true,
    allSkills: false,
    allAgents: false,
    ...overrides,
  };
}

async function withFixture(
  fn: (ctx: { root: string; sourceRepo: string; projectDir: string; configDir: string }) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "agents-config-cli-"));
  try {
    const sourceRepo = join(root, "source");
    await mkdir(join(sourceRepo, "skills", "demo-skill"), { recursive: true });
    await writeFile(join(sourceRepo, "skills", "demo-skill", "SKILL.md"), "# demo skill");
    await git(["init", "-b", "main"], sourceRepo);
    await git(["add", "."], sourceRepo);
    await git(["commit", "-m", "initial"], sourceRepo);

    const projectDir = join(root, "project");
    await mkdir(projectDir, { recursive: true });

    const configDir = join(root, "config");
    await writeConfig(configDir, "clone_method: https\ninstall_method: copy\ntargets:\n  interop: true\n");

    await fn({ root, sourceRepo, projectDir, configDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("cli/add writes agents.yaml, then installs, and cli/list reports the added dependency", async () => {
  await withFixture(async ({ sourceRepo, projectDir, configDir, root }) => {
    const container = bootstrapApp({
      cwd: projectDir,
      env: process.env,
      configDirOverride: configDir,
      cacheDirOverride: join(root, "cache"),
    });

    const add = container.resolve<(repo: string, options: AddCommandOptions) => Promise<void>>("cli/add");
    await add(`file://${sourceRepo}`, defaultAddOptions());

    const manifestContent = await readFile(join(projectDir, "agents.yaml"), "utf-8");
    assert.match(manifestContent, new RegExp(sourceRepo.replace(/[/\\]/g, "\\$&")));

    const installed = join(projectDir, ".agents", "skills", "demo-skill", "SKILL.md");
    assert.equal(await pathExists(installed), true);

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    try {
      const list = container.resolve<() => Promise<void>>("cli/list");
      await list();
    } finally {
      console.log = originalLog;
    }
    assert.ok(logs.some((line) => line.includes(sourceRepo)), `expected repo in list output: ${logs.join("\n")}`);
  });
});

test("cli/remove removes the dependency from agents.yaml and prunes the install", async () => {
  await withFixture(async ({ sourceRepo, projectDir, configDir, root }) => {
    const container = bootstrapApp({
      cwd: projectDir,
      env: process.env,
      configDirOverride: configDir,
      cacheDirOverride: join(root, "cache"),
    });

    const add = container.resolve<(repo: string, options: AddCommandOptions) => Promise<void>>("cli/add");
    await add(`file://${sourceRepo}`, defaultAddOptions());

    const installed = join(projectDir, ".agents", "skills", "demo-skill", "SKILL.md");
    assert.equal(await pathExists(installed), true);

    const remove = container.resolve<(repo: string) => Promise<void>>("cli/remove");
    await remove(`file://${sourceRepo}`);

    const manifestContent = await readFile(join(projectDir, "agents.yaml"), "utf-8");
    assert.doesNotMatch(manifestContent, new RegExp(sourceRepo.replace(/[/\\]/g, "\\$&")));
    assert.equal(await pathExists(installed), false);
  });
});

test("cli/list reports the no-dependencies hint when agents.yaml doesn't exist", async () => {
  await withFixture(async ({ projectDir, configDir, root }) => {
    const container = bootstrapApp({
      cwd: projectDir,
      env: process.env,
      configDirOverride: configDir,
      cacheDirOverride: join(root, "cache"),
    });

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    try {
      const list = container.resolve<() => Promise<void>>("cli/list");
      await list();
    } finally {
      console.log = originalLog;
    }
    assert.ok(logs.some((line) => line.includes("No dependencies configured")));
  });
});

test("cli/config prints the resolved config path and cache dir for this invocation", async () => {
  await withFixture(async ({ projectDir, configDir, root }) => {
    const cacheDir = join(root, "cache");
    const container = bootstrapApp({
      cwd: projectDir,
      env: process.env,
      configDirOverride: configDir,
      cacheDirOverride: cacheDir,
    });

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    try {
      const config = container.resolve<() => Promise<void>>("cli/config");
      await config();
    } finally {
      console.log = originalLog;
    }
    assert.ok(logs.some((line) => line.includes(join(configDir, "config.yaml"))));
    assert.ok(logs.some((line) => line.includes(cacheDir)));
  });
});

test("cli/install runs the same install pipeline as run/install", async () => {
  await withFixture(async ({ sourceRepo, projectDir, configDir, root }) => {
    await writeFile(join(projectDir, "agents.yaml"), `dependencies:\n  - repo: file://${sourceRepo}\n    ref: main\n    agents: false\n`);

    const container = bootstrapApp({
      cwd: projectDir,
      env: process.env,
      configDirOverride: configDir,
      cacheDirOverride: join(root, "cache"),
    });

    const install = container.resolve<() => Promise<void>>("cli/install");
    await install();

    const installed = join(projectDir, ".agents", "skills", "demo-skill", "SKILL.md");
    assert.equal(await pathExists(installed), true);
  });
});

test("cli/add keeps agents.yaml's targets and other settings when adding a dependency", async () => {
  await withFixture(async ({ sourceRepo, projectDir, configDir, root }) => {
    await writeFile(join(projectDir, "agents.yaml"), "# mine\ntargets:\n  claude: true\n");
    const container = bootstrapApp({
      cwd: projectDir,
      env: process.env,
      configDirOverride: configDir,
      cacheDirOverride: join(root, "cache"),
    });

    const add = container.resolve<(repo: string, options: AddCommandOptions) => Promise<void>>("cli/add");
    await add(`file://${sourceRepo}`, defaultAddOptions({ agents: false }));

    const manifestContent = await readFile(join(projectDir, "agents.yaml"), "utf-8");
    assert.match(manifestContent, /# mine/);
    assert.match(manifestContent, /claude: true/);
    assert.equal(await pathExists(join(projectDir, ".claude", "skills", "demo-skill", "SKILL.md")), true);
  });
});

test("cli/list shows dependencies from both layers with their source, and the merged targets", async () => {
  await withFixture(async ({ sourceRepo, projectDir, configDir, root }) => {
    await writeConfig(configDir, "targets:\n  interop: true\ndependencies:\n  - repo: owner/from-config\n");
    await writeFile(join(projectDir, "agents.yaml"), `targets:\n  claude: true\ndependencies:\n  - repo: file://${sourceRepo}\n`);
    const container = bootstrapApp({
      cwd: projectDir,
      env: process.env,
      configDirOverride: configDir,
      cacheDirOverride: join(root, "cache"),
    });

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    try {
      await container.resolve<() => Promise<void>>("cli/list")();
    } finally {
      console.log = originalLog;
    }
    assert.ok(logs.some((line) => line.includes("owner/from-config") && line.includes("from config.yaml")), logs.join("\n"));
    assert.ok(logs.some((line) => line.includes(sourceRepo) && line.includes("from agents.yaml")), logs.join("\n"));
    assert.ok(logs.some((line) => line === "targets: interop, claude"), logs.join("\n"));
  });
});

test("cli/list shows a path dependency, and cli/remove removes it by path", async () => {
  await withFixture(async ({ projectDir, configDir, root }) => {
    await mkdir(join(projectDir, "skills", "own"), { recursive: true });
    await writeFile(join(projectDir, "skills", "own", "SKILL.md"), "# own");
    await writeFile(join(projectDir, "agents.yaml"), "# keep me\ndependencies:\n  - path: ./\n");
    const container = bootstrapApp({
      cwd: projectDir,
      env: process.env,
      configDirOverride: configDir,
      cacheDirOverride: join(root, "cache"),
    });

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    try {
      await container.resolve<() => Promise<void>>("cli/list")();
      await container.resolve<() => Promise<void>>("cli/install")();
      assert.equal(await pathExists(join(projectDir, ".agents", "skills", "own", "SKILL.md")), true);
      await container.resolve<(r: string) => Promise<void>>("cli/remove")(".");
    } finally {
      console.log = originalLog;
    }
    assert.ok(logs.some((line) => line.includes("path:./ (live, from agents.yaml)")), logs.join("\n"));
    assert.match(await readFile(join(projectDir, "agents.yaml"), "utf-8"), /# keep me\ndependencies: \[\]/);
    assert.equal(await pathExists(join(projectDir, ".agents", "skills", "own")), false);
  });
});
