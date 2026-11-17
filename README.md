# agents-config

**Manage AI coding-agent skills across Claude Code, OpenCode, and Codex.**

Declare skills and subagents in `agents.yaml`. Install them where your coding
tools can find them, without maintaining separate copies by hand.

[Quick Start](#quick-start) · [Recipes](#recipes) · [Agent Skill](#agent-skill) · [Configuration](./docs/configuration.md) ·
[Commands](#commands) · [Architecture](./ARCHITECTURE.md) ·
[Contributing](./CONTRIBUTING.md)

```yaml
targets:
  interop: true
  claude-interop: true
dependencies:
  - repo: anthropics/skills
    skills: [skill-creator]
    agents: false
```

```text
agents-config install

.agents/skills/skill-creator/   <- shared skill, read by OpenCode and Codex
.claude/skills/skill-creator   -> ../../.agents/skills/skill-creator
agents-lock.json              <- pins dependency sources
.agents/agents-config/        <- this machine's install state, ignored by Git
```

## Why agents-config?

- **Declare the result, not the steps.** Installers such as Vercel's
  [`skills`](https://github.com/vercel-labs/skills) CLI change a project one
  `add` or `remove` at a time (its declarative sync is experimental and tied
  to `package.json`). Here `agents.yaml` is the source of truth:
  delete an entry, run `install`, and what it installed is gone.
- **One manifest, multiple coding tools.** Share skills through `.agents/`
  and let target handlers bridge the directories each tool expects.
- **Machine defaults, project overrides.** A machine `config.yaml` and the
  project's `agents.yaml` share one schema and merge, so each project
  declares only what differs.
- **Keep hand-written content safe.** Built-in handlers leave existing,
  unmanaged files alone and report conflicts instead of overwriting them.
- **Sync instead of cleaning up by hand.** Re-running installs repairs desired
  managed copies and prunes stale installs; modified stale copies are preserved
  with a warning.
- **Expose what other tools generate.** Link skills that tools such as
  OpenSpec write to `.agents/skills` into Claude Code, with no dependencies
  at all. See [the recipe](#claude-code-doesnt-see-skills-another-tool-wrote-to-agentsskills).
- **Use Git sources or your own files.** Select individual skills and agents,
  pin a Git revision, or link a live local dependency.

Need one of the dozens of coding tools agents-config has no handler for yet,
or a skill directory to browse? Vercel's `skills` covers far more tools.
Adding a tool here means writing a target handler; see
[Architecture](./ARCHITECTURE.md).

## Quick Start

Requires **Node.js 22+** and **npm**. **Git** is only required for Git repository
dependencies; local path-only installs do not require Git. Linux/WSL is the
currently supported platform.

### 1. Install the CLI

```bash
npm install --global @xedinunknown/agents-config
```

Prefer mise? See [other installation options](#other-installation-options).

### 2. Add a manifest to your project

Create `agents.yaml` in your project's root:

```yaml
targets:
  interop: true
  claude-interop: true
dependencies:
  - repo: anthropics/skills
    skills: [skill-creator]
    agents: false
```

These targets install a shared skill for OpenCode and Codex, plus a per-skill
link for Claude Code. No machine configuration is required for this example.

### 3. Install the skills

Run from that project directory:

```bash
agents-config install
agents-config list
```

The layout shown above is the result. Subsequent installs use locked Git commits.
Run `agents-config update` to refresh dependencies or after editing dependency
declarations. If your coding tool doesn't discover the skill in an
already-running session, start a new session.

Commit `agents.yaml` and `agents-lock.json`. Install state in
`.agents/agents-config/` ignores itself. To keep installed items out of Git,
either manage ignore rules yourself or opt in to per-item rules by adding
`manage_gitignore: true` at the top level of `agents.yaml` or your machine
`config.yaml`. This is off by default. When enabled, built-in handlers maintain
a `.gitignore` in each destination for their installed items, leaving other
items visible. Track those ignore files if the rules should be shared. Rules for
an entire parent directory take precedence, and already tracked files remain
tracked. See [Git ignore management](./docs/configuration.md#git-ignore-management).

Keep your own skill sources outside the install directories, for example in
[`skills/` with a `path: .` dependency](./docs/configuration.md#local-dependencies).

## Recipes

Find your problem, copy the snippet into `agents.yaml`, run `agents-config install`.

### Claude Code doesn't see skills another tool wrote to `.agents/skills`

Tools such as OpenSpec (`openspec init --tools agents`) write skills only to
`.agents/skills`, which OpenCode and Codex read but Claude Code does not. Link
them into `.claude/skills` without installing anything:

```yaml
targets:
  claude-interop:
    link:
      skills: [openspec-*]
```

```text
.claude/skills/openspec-propose -> ../../.agents/skills/openspec-propose
```

No dependencies or `interop` target are needed. The links are recorded in the
install state and pruned when a name leaves `link`; the shared entries themselves are
never touched. A pattern that matches nothing yet warns instead of failing, so
the manifest can be committed before the other tool runs. See
[`link`](./docs/configuration.md#targets-and-interop).

### Your own skills should be edited in place, not copied

Keep sources in the project's `skills/<name>/SKILL.md` and `agents/`, and
depend on the project itself. Path dependencies are linked and read live:

```yaml
dependencies:
  - path: .
```

See [local dependencies](./docs/configuration.md#local-dependencies).

### A dependency's default branch keeps changing under you

Set `ref` to a release branch, tag, or commit instead of the default `main`.
`install` always reuses the commit recorded in `agents-lock.json`; only `update`
moves it:

```yaml
dependencies:
  - repo: Dhii/containers
    ref: 0.3.x
    skills: [config-based-modularity]
    agents: false
```

### Installed skills show up in `git status`

Add `manage_gitignore: true` to `agents.yaml` or `config.yaml`. Each
destination gets a `.gitignore` block listing only the items the tool manages;
hand-written skills next to them stay visible. See
[Git ignore management](./docs/configuration.md#git-ignore-management).

### Skills should land in a non-standard directory

Reuse a built-in handler under a new target name with its own `paths`, for
example to install flat into a personal configuration repository:

```yaml
targets:
  interop: false
  agents-root:
    handler: interop
    paths:
      skills: skills
      agents: agents
```

See [custom destinations](./docs/configuration.md#custom-destinations).

## Agent Skill

The [`agents-config` skill](./skills/agents-config/SKILL.md) teaches a coding
agent to use this tool for you: write `agents.yaml`, pick targets for the tools
you use, run `install` or `update`, explain warnings, and say what to commit.
Install it like any other skill:

```yaml
dependencies:
  - repo: XedinUnknown/agents-config
    ref: 0.1.x
    skills: [agents-config]
    agents: false
```

## Everyday Usage

Add another skill without editing YAML by hand:

```bash
agents-config add vercel-labs/agent-browser --skill agent-browser --no-agents
```

`add` updates the manifest, refreshes the lock, and installs immediately. To remove that dependency
and prune its managed installs:

```bash
agents-config remove vercel-labs/agent-browser
```

Set common targets once in `~/.config/agents-config/config.yaml`, then keep
project manifests focused on their dependencies. Machine defaults are merged
first; project settings override them. **There is no default target**: either
file must declare one. See [machine defaults](./docs/configuration.md#machine-defaults).

### Coding Tool Support

| Tool | Skills with the Quick Start | Agent support |
|---|---|---|
| Claude Code | Per-skill links in `.claude/skills` | `.claude/agents` |
| OpenCode | Reads `.agents/skills` directly | `.opencode/agents`; use `opencode-interop` to bridge shared agents |
| Codex | Reads `.agents/skills` directly | Currently skipped; requires TOML conversion |

Agents are installed without format conversion. OpenCode and Claude Code agent
formats differ, so an agent must already suit its destination. See the
[target reference](./docs/configuration.md#targets-and-interop) for paths,
interop settings, and limitations.

### Commands

| Command | Action |
|---|---|
| `agents-config install` | Install locked commits; resolve and create a lock if absent |
| `agents-config update` | Resolve dependencies, update the lock if needed, then install |
| `agents-config add <repo>` | Add or change a dependency, then update and install |
| `agents-config remove <repo>` | Remove a dependency, then update and prune its installs |
| `agents-config list` | List dependencies, their configuration source, and targets |
| `agents-config config` | Print resolved config and cache paths |

Run `agents-config --help` or `agents-config <command> --help` for flags and
defaults. `--config <dir>` and `--cache-dir <dir>` override locations for one
invocation.

## Other Installation Options

With [mise](https://mise.jdx.dev), which also provides Node.js:

```bash
mise use -g node@22 'npm:@xedinunknown/agents-config[allow_low_downloads=true]'
agents-config --help
```

The low-download exemption applies only to this package; mise requires it
while the package has fewer than 1,000 weekly downloads.

[GitHub Releases](https://github.com/XedinUnknown/agents-config/releases) also
attach package tarballs, installable with
`npm install --global ./xedinunknown-agents-config-X.Y.Z.tgz`.
To run from a checkout, see [Contributing](./CONTRIBUTING.md).

## Documentation

- [Configuration](./docs/configuration.md): settings, dependencies, targets,
  interop, and migration from agentdeps.
- [Architecture](./ARCHITECTURE.md): resolution, ownership, cleanup, and
  extensible target handlers.
- [Contributing](./CONTRIBUTING.md): development setup, checks, packaging, and releases.
- [Changelog](./CHANGELOG.md): release history.
- [Agent instructions](https://github.com/XedinUnknown/agents-config/blob/0.1.x/AGENTS.md):
  repository-specific constraints and implementation notes.

## Acknowledgements

Inspired by [`agentdeps`](https://github.com/jgordijn/agentdeps)' declarative
Git dependency model. This is an independent implementation, not affiliated
with, forked from, or derived from agentdeps. Manifest compatibility is retained
where useful; the flat, lockfile-based installation model is independent.
