# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] YYYY-MM-DD

### Added

- `update` resolves dependencies, updates `agents-lock.json` if needed, then installs.
- Opt-in `manage_gitignore` setting (default `false`) lets built-in handlers
  maintain per-target `.gitignore` blocks for lock-owned installs, preserving
  user content and other targets' blocks. Unsafe or
  outside-project ignore updates are warned about and retried; existing Git
  tracking is not changed, and empty ignore files can remain after cleanup.
  Disabling it leaves existing blocks untouched, so they may become stale until
  re-enabled; users may remove stale blocks manually. Handler switches may
  require management enabled to complete old-handler cleanup.

- `link` setting for `*-interop` targets exposes selected unmanaged entries
  in `.agents/` (names or globs per kind), linked or installed per
  `unsupported`, recorded as `declared` and covered by the managed
  `.gitignore` block. Unmatched patterns produce a warning.

### Changed

- `install` uses locked Git commits, resolving only when no lockfile exists.
  Dependency declaration changes and older ownership-only locks require `update`.
- Git-backed installs use immutable cached snapshots, including link installs.
  Live path dependencies remain live. `add` and `remove` now update before installing.
- `path` dependencies are always live directories, linked by default, with an
  optional copy override. They no longer accept `ref` or require Git. Use a
  `repo: file:///absolute/path/to/repository` dependency with `ref` for a
  versioned local repository.
- `*-interop` handlers with `unsupported: symlink` link only requested items,
  no longer every entry in `.agents/`. Hand-written entries and those written
  by other tools are no longer linked or recorded in `agents-lock.json` or the
  managed `.gitignore` block; links an earlier version recorded for them are
  removed on the next install.
- Installation output summarizes added, updated, and removed items by count per
  target instead of listing every skill and agent. Warnings remain detailed.

### Removed

- Git revision snapshots for `path` dependencies, their cache service, and
  `git archive`/`tar` extraction.

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
