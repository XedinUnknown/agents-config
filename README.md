# agents-config

Declarative dependency manager for AI coding-agent skills and subagents.
`agents-config` reads Git dependencies from `agents.yaml` and installs selected
items directly into the flat directories scanned by each configured harness.

The project is inspired by
[`agentdeps`](https://github.com/jgordijn/agentdeps)' declarative Git dependency
model and retains manifest compatibility where useful. It is not affiliated
with, forked from, or derived from `agentdeps`; its implementation and flat
lockfile-based installation model are independent.

## Status

The core installer is implemented and covered by automated tests, but the CLI
has not been released yet. Run it from this checkout during development:

```bash
npm install
npm run agents-config -- --help
```

## How It Works

1. Read the current directory's `agents.yaml`.
2. Clone or update each declared repository in the configured cache directory.
3. Discover skills under `skills/<name>/SKILL.md` and agents under `agents/`.
4. Apply the skill and agent selections declared in `agents.yaml`.
5. Send that already-selected desired set to each harness adapter configured in
   `config.yaml`; adapters decide where and how to install it, not what the
   manifest selects.
6. Record managed top-level names in `agents-lock.json` inside each target
   directory.

Managed content is installed flat, not under a private nested directory. On
subsequent runs, `agents-config` updates or removes only lockfile-owned names.
An existing name that is not lockfile-owned is left untouched and reported.
Same-name dependencies are reported as collisions; the first declaration wins.

Pruning compares the current desired top-level names with the names owned by
the target directory's lockfile. A lock-owned name absent from the desired set
is removed from disk and from the lockfile. This occurs when a dependency or
selection is removed from `agents.yaml`. Fetch failures abort before any target
is synchronized, and names not owned by the lockfile are never pruned.

Only currently configured harnesses are synchronized. Removing a harness from
`config.yaml` does not revisit its former target directory, so it cannot prune
that directory. Prune its managed entries before removing the harness from the
configuration.

With `install_method: copy`, managed files are restored when missing or locally
modified. With `install_method: link`, targets are symlinked to the cached
checkout.

## Architecture

`src/index.ts` is the CLI host. It adapts the current directory, environment,
and command-line overrides, calls `bootstrapApp()`, and dispatches each command
through the resulting application container.

Application services are keyed lazy definitions composed in deterministic
order: platform, config, repository cache, discovery, manifest, lockfile,
hashing, installation, orchestration, CLI commands, and final host overrides.
Harnesses use a nested container because custom harness key names are only
known after `config.yaml` has been loaded.

The composition implementation in `src/di/` is a vendored copy of the
unpublished `@uny/di` package from the sibling
[`UN1Q-com/uny`](https://github.com/UN1Q-com/uny) project. It is copied into
this repository, not linked at runtime. Local differences are limited to
TypeScript source-import adaptation, strict-type compatibility fixes, and
provenance comments; upstream changes must currently be synchronized manually.

## Configuration

Tool configuration lives at
`$XDG_CONFIG_HOME/agents-config/config.yaml` (normally
`~/.config/agents-config/config.yaml`):

```yaml
clone_method: https
install_method: copy
agents:
  - interop
```

Fields:

- `clone_method`: `https` or `ssh`.
- `install_method`: `copy` or `link`.
- `agents`: harness names to target. If omitted, defaults to `interop`.
- `custom_agents`: custom or overriding harness paths relative to the current
  working directory.

Built-in harnesses:

| Name | Skills | Agents |
|---|---|---|
| `interop` | `.agents/skills` | `.agents/agents` |
| `claude` | `.claude/skills` | `.claude/agents` |
| `opencode` | `.agents/skills` | `.agents/agents` |
| `codex` | `.codex/skills` | `.codex/agents` |

The Codex flat-file adapter has not been verified against Codex discovery.

Custom harness example:

```yaml
custom_agents:
  agents-root:
    project_skills: skills
    project_agents: agents
agents:
  - agents-root
```

All target paths are relative to the directory where the command runs. There
is no separate global mode. A machine-wide configuration directory is handled
as an ordinary project with appropriate relative custom paths.

## Manifest

Each managed project declares dependencies in `agents.yaml`:

```yaml
dependencies:
  - repo: Dhii/containers
    ref: 0.3.x
    skills:
      - config-based-modularity
    agents: false
```

`repo` accepts `owner/repo`, an HTTPS URL, an SSH URL, or a local Git path.
`ref` defaults to `main`. `skills` and `agents` accept a list, `"*"`/`true`
for everything, or `false` for nothing.

## Commands

```text
agents-config install          Sync dependencies from agents.yaml
agents-config add <repo>       Add or update a dependency, then sync
agents-config remove <repo>    Remove a dependency, then prune its installs
agents-config list             List configured dependencies and targets
agents-config config           Print resolved config and cache paths
```

Run `agents-config --help` or `agents-config <command> --help` for flags and
defaults. `--config <dir>` and `--cache-dir <dir>` override their respective
locations for one invocation.

## Development

```bash
npm install
npm run typecheck
npm test
```

The tests use local temporary Git repositories and do not require network
access. Do not test installation against real skill or agent directories until
the same scenario has passed with isolated config, cache, and project paths.

See [AGENTS.md](./AGENTS.md) for design rationale, constraints, and current
implementation notes.
