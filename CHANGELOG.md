# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] YYYY-MM-DD

## [0.1.0-beta.1] - 2026-10-25

### Added

- `install`, `add`, `remove`, `list` and `config` commands.
- Flat installation of skills and agents from Git dependencies into each
  target's directories, so harnesses that scan only immediate children find
  them.
- Layered settings: `config.yaml` (machine defaults) and `agents.yaml`
  (project) share one schema and merge in that order.
- `targets` map: `true` enables a target, `false` disables an inherited one,
  a map adds a target or overrides an inherited one's settings. There is no
  default target: `install` stops until a layer declares one. Targets run in
  the order they first appear.
- One handler per harness (`interop`, `claude`, `opencode`, `codex`), each
  with its own default paths. Modules can add or override handlers.
- `claude-interop`, `opencode-interop` and `codex-interop` handlers, which
  make a harness see what `interop` installed in `.agents/`: what the harness
  reads there natively is left to it, the rest is linked (`unsupported:
  symlink`) or installed as the plain handler would (`unsupported: install`).
- Links to sources inside the project are relative, so they keep working
  when the project moves.
- `path` dependencies: a folder with the standard `skills/` + `agents/`
  layout, relative to the project. Read live and linked by default, or with
  `ref` read from git at that revision and pinned to its commit in
  `agents-lock.json`. A project's own skills come in via `path: .`.
- Per-dependency `install_method`.
- `remove` accepts a repository or a path.
- Same-name skills or agents from different dependencies resolve to the later
  dependency.
- Project-level `agents-lock.json` recording each installed name's source and
  every installed path, so removed dependencies, disabled targets and
  changed paths are cleaned up.
- The `codex` handlers skip agents with a warning, since Codex agents are
  TOML files and converting them isn't implemented.
- Fallback to the `agentdeps` configuration directory when no
  `agents-config` one exists.
- Compiled, installable package `@xedinunknown/agents-config`, published to
  npm when a GitHub Release is published, and installable with mise.
- CI running typecheck, tests, and an install of the packed CLI on every push
  and pull request.
- `make` targets for setup, building, testing, and packing.

### Removed

- Bare filesystem paths as `repo`. `repo` takes a repository URI
  (`https://`, `git@host:`, `ssh://`, `file://`) or `owner/repo`; use `path`
  for a folder.

- `agentdeps`' `agents` and `custom_agents` configuration keys. They are
  rejected with a hint to use `targets`.

[unreleased]: https://github.com/XedinUnknown/agents-config/commits/0.1.x
