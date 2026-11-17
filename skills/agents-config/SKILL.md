---
name: agents-config
description: Use the agents-config CLI to install, share, and sync AI coding-agent skills and subagents across Claude Code, OpenCode, and Codex from a declarative agents.yaml. Use this whenever the user mentions agents.yaml, agents-lock.json, or agents-config; asks to install, add, remove, pin, or update skills or subagents for Claude Code, Codex, or OpenCode; wants to share skills between coding agents or with teammates; says Claude Code (or another tool) doesn't see their skills, including skills another tool such as OpenSpec wrote to .agents/skills; or asks which skill files to commit. Also use it to explain install output such as conflicts, "later dependency wins" collisions, or preserved modified copies.
---

# agents-config

`agents-config` installs skills and subagents declared in a project's
`agents.yaml` into the directories each coding tool reads, records resolved
sources in `agents-lock.json`, and prunes what is no longer declared. It never
overwrites content it did not install.

Every setting and flag used below comes from the tool's own documentation.
Do not invent others; when unsure, run `agents-config <command> --help` or read
[references/manifest.md](references/manifest.md).

## References (load when needed)

- [references/manifest.md](references/manifest.md): `agents.yaml` /
  `config.yaml` schema, targets and their paths, `link`, dependencies, and
  pinning. Read before writing or changing a manifest.
- [references/output.md](references/output.md): what each line of
  `install`/`update` output means and what to tell the user. Read whenever a
  run prints a `⚠` line or an error.

## Workflow

### 1. Check the tool and current state

```bash
agents-config --help
agents-config config   # resolved machine config.yaml and repo cache paths
agents-config list     # dependencies, their source file, and targets
```

If the command is missing, or lacks `update` or `link` support, the user needs
to install or upgrade it (README: `npm install --global
@xedinunknown/agents-config`, or mise). Ask before installing global tools.

Read the machine `config.yaml` that `agents-config config` names, if it
exists, and the project's `agents.yaml`. They merge (machine first, project
wins), so targets and dependencies may already come from the machine file.

### 2. Pick targets for the tools the user actually uses

Ask which coding tools they use if it isn't clear. There is no default target:
`install` fails until some layer declares one.

| User uses | Targets |
|---|---|
| Claude Code | `interop` + `claude-interop` |
| OpenCode | `interop` (skills); add `opencode-interop` for shared agents |
| Codex | `interop` (skills); Codex agents are skipped (TOML not supported) |
| All three | `interop`, `claude-interop`, `opencode-interop`, `codex-interop` |

Put `interop` first. Targets that should apply to every project on this
machine belong in the machine `config.yaml`; targets that teammates must share
belong in `agents.yaml`. Changing the machine file affects every project, so
confirm with the user first.

### 3. Declare dependencies

- Third-party Git source: `agents-config add owner/repo --skill <name> --no-agents`
  edits `agents.yaml`, updates the lock, and installs in one step. Use
  `--ref` to pin a branch, tag, or commit.
- The project's own skills: keep sources in `skills/<name>/SKILL.md` and
  `agents/`, and add `- path: .` by hand (`add` only takes repositories).
  Path dependencies are live links; edits show up immediately.
- Skills another tool wrote to `.agents/skills` (e.g. OpenSpec) that Claude
  Code can't see: no dependency needed, use `claude-interop`'s `link` setting.

Prefer explicit `skills: [...]` lists and `agents: false` for skill-only
sources over installing everything.

### 4. Run it

- `agents-config update` after any change to dependency declarations (in
  either file). `install` refuses with "Dependencies differ from
  agents-lock.json" until then.
- `agents-config install` to apply target-setting changes, repair missing or
  modified managed copies, or set up a fresh clone from the committed lock.
- `agents-config remove <repo-or-path>` to drop a dependency and prune it.

Read the output with [references/output.md](references/output.md) and report
each warning to the user in plain words: what happened, and whether anything
needs their decision. Do not delete or overwrite a file the tool reported as
untracked or modified in order to silence a warning without asking.

Tell the user to start a new session of their coding tool if the new skills
don't appear in a running one.

### 5. Commit the right files

| Commit | Per-machine, don't commit |
|---|---|
| `agents.yaml`, `agents-lock.json` | `.agents/agents-config/` (install state; ignores itself) |
| Authored sources (`skills/`, `agents/`) | Machine `config.yaml` and the repo cache |
| Managed `.gitignore` files, if the rules should be shared | |

Installed copies and links in `.agents/`, `.claude/`, etc. are reproducible from
the two committed files. Keep them out of Git with the user's own ignore rules
or `manage_gitignore: true` (opt-in, see the manifest reference). Never edit
`agents-lock.json` or the state file by hand.
