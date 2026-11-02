#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { bootstrapApp } from "./app.ts";
import type { Container } from "./di/index.ts";
import type { AddCommandOptions } from "./cli.ts";

const program = new Command()
  .name("agents-config")
  .description("Declarative dependency manager for AI coding agent skills and subagents")
  .option(
    "-c, --config <dir>",
    "Config directory to use instead of $XDG_CONFIG_HOME/agents-config (or the legacy" +
      " $XDG_CONFIG_HOME/agentdeps, used automatically when only it has a config.yaml)." +
      " Holds config.yaml."
  )
  .option(
    "--cache-dir <dir>",
    "Repo cache directory to use instead of $XDG_CACHE_HOME/agents-config/repos" +
      " (or ~/.cache/agents-config/repos if XDG_CACHE_HOME is unset). This is where" +
      " dependency repos are cloned/updated."
  )
  .addHelpText(
    "after",
    `
Defaults:
  Without --config, and without a config.yaml at $XDG_CONFIG_HOME/agents-config,
  falls back to the legacy $XDG_CONFIG_HOME/agentdeps directory if it has one.
  Without --cache-dir, dependency repos are cloned into
  $XDG_CACHE_HOME/agents-config/repos (~/.cache/agents-config/repos by default).

Run 'agents-config config' to see the resolved paths for the current invocation.
`
  );

// Set once by the preAction hook below, before any command's .action() runs —
// the one piece of process-lifetime state this CLI has, matching how the
// Bootstrap Pattern expects a host to hold its own composed container.
let container: Container;

program.hook("preAction", (thisCommand) => {
  const { config, cacheDir } = thisCommand.opts<{ config?: string; cacheDir?: string }>();

  container = bootstrapApp({
    cwd: process.cwd(),
    env: process.env,
    ...(config !== undefined ? { configDirOverride: resolve(config) } : {}),
    ...(cacheDir !== undefined ? { cacheDirOverride: resolve(cacheDir) } : {}),
  });
});

program
  .command("install")
  .description(
    "Install locked dependencies. Without a lockfile, resolve dependencies and create one."
  )
  .addHelpText(
    "after",
    `
Settings are layered: config.yaml (machine defaults), then the current
directory's agents.yaml. Both files share one schema
(clone_method, install_method, manage_gitignore, targets, dependencies);
later layers win.

manage_gitignore is a top-level boolean (default false); the project value
overrides the machine value. When true, built-in handlers maintain per-target
.gitignore blocks for lock-owned installs, not foreign items. When false, they
leave existing blocks untouched, so they may become stale until re-enabled. You may
clean them up manually; a handler switch may require management enabled to
finish the old handler's cleanup.

Existing locks pin Git commits. Changes to dependency declarations require
'agents-config update'; target settings can change without updating dependencies.
Live path dependencies remain live. Older locks need one update to pin commits.

Targets come from the merged "targets" map: true enables one, false disables
an inherited one, and a map of settings adds or overrides one. Each target is
installed by the handler with its name (built-ins: interop, claude, opencode,
codex) unless it sets "handler:" to another; settings left out or set to null
use that handler's defaults, e.g. paths: { skills, agents }. There is no
default target: install stops until a layer declares "targets" — normally
"interop: true" in config.yaml. Targets run in the order they first appear,
config.yaml's first, so *-interop targets (claude-interop, opencode-interop,
codex-interop) go after interop and link or install what their harness
can't read from .agents/.

Dependencies from both files are merged by repo; a project entry replaces a
config.yaml entry for the same repo. When two dependencies provide the same
skill or agent name, the later one wins. What was installed, and where, is
recorded in agents-lock.json next to agents.yaml.

Everything installs relative to the current directory — there is no separate
"global" install mode. To always install into one fixed, machine-wide
location (e.g. a real ~/.claude/skills), run 'agents-config install' from
within that directory as its own project instead.
`
  )
  .action(async () => {
    await container.resolve<() => Promise<void>>("cli/install")();
  });

program
  .command("update")
  .description("Resolve current dependencies, update agents-lock.json if needed, then install and prune")
  .action(async () => {
    await container.resolve<() => Promise<void>>("cli/update")();
  });

program
  .command("list")
  .description("List dependencies configured in the current directory's agents.yaml")
  .action(async () => {
    await container.resolve<() => Promise<void>>("cli/list")();
  });

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

program
  .command("add")
  .description("Add a dependency to agents.yaml, then update and install dependencies")
  .argument("<repo>", "Repository (owner/repo or full URL)")
  .option("--ref <ref>", "Git ref (branch, tag, SHA)", "main")
  .option("--skill <name>", "Install specific skill (repeatable)", collect, [])
  .option("--agent <name>", "Install specific agent (repeatable)", collect, [])
  .option("--all-skills", "Install all skills")
  .option("--all-agents", "Install all agents")
  .option("--no-skills", "Don't install any skills")
  .option("--no-agents", "Don't install any agents")
  .action(async (repo: string, options: AddCommandOptions) => {
    await container.resolve<(repo: string, options: AddCommandOptions) => Promise<void>>("cli/add")(repo, options);
  });

program
  .command("remove")
  .description("Remove a dependency from agents.yaml, then update and install to prune it")
  .argument("<repo>", "Repository to remove")
  .action(async (repo: string) => {
    await container.resolve<(repo: string) => Promise<void>>("cli/remove")(repo);
  });

program
  .command("config")
  .description("Show resolved config/cache paths for this invocation (edit config.yaml directly)")
  .action(async () => {
    await container.resolve<() => Promise<void>>("cli/config")();
  });

program.parse();
