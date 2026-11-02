# agents-config

**Manage AI coding-agent skills across Claude Code, OpenCode, and Codex.**

Declare skills and subagents in `agents.yaml`. Install them where your coding
tools can find them, without maintaining separate copies by hand.

[Quick Start](#quick-start) · [Configuration](./docs/configuration.md) ·
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
agents-lock.json              <- tracks sources and installed paths
```

## Why agents-config?

- **One manifest, multiple coding tools.** Share skills through `.agents/`
  and let target handlers bridge the directories each tool expects.
- **Keep hand-written content safe.** Built-in handlers leave existing,
  unmanaged files alone and report conflicts instead of overwriting them.
- **Sync instead of cleaning up by hand.** Re-running installs repairs desired
  managed copies and prunes stale installs; modified stale copies are preserved
  with a warning.
- **Use Git sources or your own files.** Select individual skills and agents,
  pin a Git revision, or link a live local dependency.

## Quick Start

Requires **Node.js 22+**, **npm**, and **Git**. Linux/WSL is the currently
supported platform.

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

Commit `agents.yaml` and `agents-lock.json`. Ignore the generated install
directories, such as `.agents/skills/` and `.claude/skills/`, in `.gitignore`.
Keep your own skill sources outside those directories, for example in
[`skills/` with a `path: .` dependency](./docs/configuration.md#local-dependencies).

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
