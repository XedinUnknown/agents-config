# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `install`, `add`, `remove`, `list` and `config` commands.
- Flat installation of skills and agents from Git dependencies into each
  target's directories, so harnesses that scan only immediate children find
  them.
- Layered settings: `config.yaml` (machine defaults) and `agents.yaml`
  (project) share one schema and merge in that order.
- `targets` map: `true` enables a target, `false` disables an inherited one,
  a map adds a target or overrides an inherited one's settings.
- One handler per harness (`interop`, `claude`, `opencode`, `codex`), each
  with its own default paths. Modules can add or override handlers.
- Same-name skills or agents from different dependencies resolve to the later
  dependency.
- Project-level `agents-lock.json` recording each installed name's source and
  every installed path, so removed dependencies, disabled targets and
  changed paths are cleaned up.
- Fallback to the `agentdeps` configuration directory when no
  `agents-config` one exists.
- Compiled, installable package `@xedinunknown/agents-config`, published to
  GitHub Packages when a GitHub Release is published.
- CI running typecheck, tests, and an install of the packed CLI on every push
  and pull request.

### Removed

- `agentdeps`' `agents` and `custom_agents` configuration keys. They are
  rejected with a hint to use `targets`.

[unreleased]: https://github.com/XedinUnknown/agents-config/commits/0.1.x
