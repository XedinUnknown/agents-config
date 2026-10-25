# agents-config

Declarative dependency manager for AI coding-agent skills and subagents.
`agents-config` reads Git dependencies from `agents.yaml` and installs selected
items directly into the flat directories scanned by each configured harness.

The project is inspired by
[`agentdeps`](https://github.com/jgordijn/agentdeps)' declarative Git dependency
model and retains manifest compatibility where useful. It is not affiliated
with, forked from, or derived from `agentdeps`; its implementation and flat
lockfile-based installation model are independent.

## Installation

Releases are published to npm as `@xedinunknown/agents-config`. It needs
Node.js 22 or later.

With [mise](https://mise.jdx.dev), which also provides Node.js:

```bash
mise use -g node@22 'npm:@xedinunknown/agents-config[allow_low_downloads=true]'
agents-config --help
```

`allow_low_downloads` is needed while the package has fewer than 1000 weekly
downloads: mise's npm installer refuses such packages on first install unless
they're explicitly allowed. The exemption covers only this package.

With npm:

```bash
npm install --global @xedinunknown/agents-config
```

Each GitHub Release also has the package tarball attached:
`npm install --global ./xedinunknown-agents-config-X.Y.Z.tgz`.

To run it from a checkout instead:

```bash
make setup
npm run agents-config -- --help
```

See [CHANGELOG.md](./CHANGELOG.md) for what changed in each release.

## How It Works

1. Merge settings layers: `config.yaml` (machine defaults), then the
   current directory's `agents.yaml`.
2. Clone or update each merged dependency in the configured cache directory.
   Any fetch failure aborts before the filesystem is changed.
3. Discover skills under `skills/<name>/SKILL.md` and agents under `agents/`,
   and apply each dependency's selections.
4. Build the plan: when two dependencies provide the same skill or agent name,
   the later one wins and only the winner is installed.
5. Call each target's handler to install the winners however its harness
   needs (the built-in handlers copy or link them flat into the harness's
   directories), and record the winners and each target's install in
   `agents-lock.json` next to `agents.yaml`.

Managed content is installed flat, not under a private nested directory. On
subsequent runs, `agents-config` updates or removes only lock-owned paths.
An existing path that is not lock-owned is left untouched and reported.

A lock-owned path absent from the current plan is removed: this happens when
a dependency or selection is removed, when a later dependency takes over a
name, or when a target is disabled or its paths change. A lock-owned copy
modified on disk since installation is left in place with a warning instead
of being removed.

With `install_method: copy`, desired managed files are restored when missing
or locally modified. With `install_method: link`, targets are symlinked to the
cached checkout.

## Architecture

`src/index.ts` is the CLI host. It adapts the current directory, environment,
and command-line overrides, calls `bootstrapApp()`, and dispatches each command
through the resulting application container.

Application services are keyed lazy definitions composed in deterministic
order: platform, config, repository cache, discovery, manifest, lockfile,
hashing, installation, orchestration, CLI commands, and final host overrides.
Targets are data merged from the settings layers. Target handlers are
container definitions (`handler/<name>`), so a module passed to
`bootstrapApp({ modules })` can add a handler for a new harness, with its own
defaults, or override a built-in one.

The composition implementation in `src/di/` is a vendored copy of the
unpublished `@uny/di` package from the sibling
[`UN1Q-com/uny`](https://github.com/UN1Q-com/uny) project. It is copied into
this repository, not linked at runtime. Local differences are limited to
TypeScript source-import adaptation, strict-type compatibility fixes, and
provenance comments; upstream changes must currently be synchronized manually.

## Configuration

`config.yaml` (machine defaults, at `$XDG_CONFIG_HOME/agents-config/config.yaml`,
normally `~/.config/agents-config/config.yaml`) and each project's
`agents.yaml` share one schema. Both are optional layers; `install` runs only
in a directory that has an `agents.yaml`.

```yaml
clone_method: https
install_method: copy
targets:
  claude: true
dependencies:
  - repo: Dhii/containers
    ref: 0.3.x
    skills:
      - config-based-modularity
    agents: false
```

Fields:

- `clone_method`: `https` (default) or `ssh`.
- `install_method`: `copy` (default) or `link`.
- `targets`: a map of target name to `true` (enable), `false` (disable an
  inherited target), or a map of settings (add a target or override an
  inherited one's settings). Each target is installed by the handler with its
  name, unless it names another with `handler:`. A setting that is absent or
  `null` uses the handler's default. There is no default target: `install`
  stops with an error until some layer declares `targets`, normally
  `interop: true` in `config.yaml`. Targets run in the order they first
  appear (`config.yaml` first); re-declaring an inherited target doesn't move
  it.
- `dependencies`: each has exactly one of `repo` or `path`.
  - `repo` is a repository URI (`https://`, `git@host:`, `ssh://`,
    `file://`) or `owner/repo` GitHub shorthand. `ref` defaults to `main`.
    A bare filesystem path is rejected: use `path`, or `file://` for a
    repository.
  - `path` is a folder with the standard `skills/` + `agents/` layout,
    relative to the project (or absolute). Without `ref` it is read live
    from disk and linked by default, so edits show up immediately. With
    `ref` it is read from git at that revision (uncommitted changes
    excluded), pinned to the resolved commit in `agents-lock.json`, and
    follows `install_method` like a repo. It is read with `git archive`, so
    files the repository marks `export-ignore` in `.gitattributes` are left
    out.
  - `skills` and `agents` accept a list, `"*"`/`true` for everything, or
    `false` for nothing. `install_method` overrides the run's install method
    for one dependency.

A project's own skills belong in its `skills/` and `agents/`, the same layout
as any repository installed from, and are installed like any dependency:

```yaml
dependencies:
  - path: .          # live; or add `ref: v1.2` to pin a revision
  - repo: anthropics/skills
    skills: [skill-creator]
```

Install folders (`.agents/skills`, `.claude/skills`, ...) then contain only
installed content and can be ignored as a whole.

Layers merge in the order `config.yaml`, `agents.yaml`: scalars
replace, maps merge by key. A dependency in `agents.yaml` replaces a
`config.yaml` dependency with the same repo or path in place; other
dependencies are appended.

Built-in handlers and their default `paths`:

| Handler | `paths.skills` | `paths.agents` |
|---|---|---|
| `interop` | `.agents/skills` | `.agents/agents` |
| `claude` | `.claude/skills` | `.claude/agents` |
| `opencode` | `.opencode/skills` | `.opencode/agents` |
| `codex` | `.codex/skills` | `.codex/agents` |
| `claude-interop` | `.claude/skills` | `.claude/agents` |
| `opencode-interop` | `.opencode/skills` | `.opencode/agents` |
| `codex-interop` | `.codex/skills` | `.codex/agents` |

Agents are copied unchanged; OpenCode's agent format differs from Claude
Code's. Codex agents are TOML files, so the `codex` handlers don't install
agents at all (each run warns how many were skipped) until conversion
exists.

The `*-interop` handlers are for a harness used alongside `interop`, which
must come earlier in the targets so that `.agents/` is filled first. For each
kind, if the harness reads `.agents/` natively (OpenCode and Codex skills),
items already there are left to it. If it doesn't, the `unsupported` setting
decides: `symlink` (default) links every entry in `.agents/`, installed or
hand-written, into the harness's directory; `install` installs the requested
items exactly as the plain handler would (following `install_method`).
Requested items missing from `.agents/` are installed as the plain handler
would. Each `*-interop` handler extends its plain handler, so it takes the
same settings (e.g. `paths`), and a module that overrides the plain handler
changes both. `codex-interop` defaults to, and only allows, `install`.
`interop_paths` changes where `.agents/` is looked up.

Links to something inside the project, like these, are relative, so they
keep working when the project is moved or cloned. Links into the dependency
cache (`install_method: link`) are absolute.

```yaml
targets:
  interop: true
  claude-interop: true
```

What each harness reads (official docs; OpenCode and Codex also checked
against their binaries):

| | Skills | Agents |
|---|---|---|
| Claude Code | `.claude/skills` | `.claude/agents` |
| OpenCode | `.opencode/skills`, `.claude/skills`, `.agents/skills` | `.opencode/agents` |
| Codex | `.agents/skills`, `.codex/skills` | `.codex/agents` (TOML) |

Custom target example, reusing the `interop` handler with other paths:

```yaml
targets:
  agents-root:
    handler: interop
    paths:
      skills: skills
      agents: agents
```

All target paths are relative to the directory where the command runs. There
is no separate global mode. A machine-wide configuration directory is handled
as an ordinary project with appropriate relative custom paths.

The `dependencies` shape is compatible with `agentdeps`' `agents.yaml`. Its
`config.yaml` keys `agents` and `custom_agents` are rejected with a hint to
use `targets`; when only `$XDG_CONFIG_HOME/agentdeps/config.yaml` exists, it
is read as a fallback, so it must be migrated first.

## Commands

```text
agents-config install          Sync merged dependencies into the enabled targets
agents-config add <repo>       Add or update a dependency, then sync
agents-config remove <repo>    Remove a dependency, then prune its installs
agents-config list             List merged dependencies (with their source) and targets
agents-config config           Print resolved config and cache paths
```

Run `agents-config --help` or `agents-config <command> --help` for flags and
defaults. `--config <dir>` and `--cache-dir <dir>` override their respective
locations for one invocation.

## Development

```bash
make setup      # install dependencies
make check      # typecheck and test
make dev        # re-run the tests on every change
make build      # compile to dist/, as published
make pack       # build the npm package tarball
make help       # list all targets
```

CI runs `make check` and `make pack` on every push to `master` or a version
branch (`0.1.x`, ...) and on every pull request, then installs the packed CLI
and runs it.

### Releasing

1. Move the `## [Unreleased]` entries in `CHANGELOG.md` under a new
   `## [X.Y.Z] - YYYY-MM-DD` heading, add its compare link at the bottom, and
   merge that.
2. Publish a GitHub Release with the tag `vX.Y.Z` on that commit. Mark it as a
   pre-release to publish under the `next` npm tag instead of `latest`.

The release workflow fails unless the tag is `vX.Y.Z` and `CHANGELOG.md` has a
`## [X.Y.Z]` section. It runs `make check`, sets the package version from the
tag, publishes to npm, and attaches the package tarball to the release.

Publishing authenticates with npm trusted publishing: on npmjs.com, the
package's settings name `XedinUnknown/agents-config` and the workflow
`release.yml` as its trusted publisher, allowed to `npm publish`, so no token
is stored anywhere. The package requires 2FA and refuses tokens for any other
publishing. npm generates no provenance attestation while the repository is
private.

The tests use local temporary Git repositories and do not require network
access. Do not test installation against real skill or agent directories until
the same scenario has passed with isolated config, cache, and project paths.

See [AGENTS.md](./AGENTS.md) for design rationale, constraints, and current
implementation notes.
