# cli Specification

## Purpose
Defines the `agents-config` commands, their options, and the project-directory rules they share.

## Requirements

### Requirement: Project directory scope
Every command SHALL operate relative to the current directory; there is no global install mode. `install` and `update` MUST do nothing but report when the current directory has no `agents.yaml`, even if `config.yaml` declares dependencies.

#### Scenario: No manifest
- **WHEN** `agents-config install` runs in a directory without `agents.yaml`
- **THEN** it prints "No agents.yaml found in the current directory." and changes nothing

### Requirement: Location overrides
The global options `-c, --config <dir>` and `--cache-dir <dir>` SHALL override the machine configuration directory and the repository cache for one invocation. `agents-config config` MUST print the resolved configuration file and repository cache paths.

#### Scenario: Confirming an override
- **WHEN** `agents-config --cache-dir /tmp/c config` runs
- **THEN** it prints `Repo cache: /tmp/c`

### Requirement: Install and update commands
`install` SHALL install locked resolutions, creating the lock if absent. `update` SHALL resolve current declarations, write the lock only if it changes, then install and prune.

#### Scenario: Refreshing dependencies
- **WHEN** `agents-config update` runs after a dependency's branch advanced
- **THEN** the lock records the new commit and the new content is installed

### Requirement: Add command
`add <repo>` SHALL accept `--ref` (default `main`), repeatable `--skill` and `--agent`, `--all-skills`, `--all-agents`, `--no-skills`, and `--no-agents`; no named items means all. It MUST reject non-repository arguments, fetch the repository to report what it provides, add or replace the dependency in `agents.yaml` while preserving other keys and comments, then run `update`.

#### Scenario: Skill-only addition
- **WHEN** `agents-config add vercel-labs/agent-browser --skill agent-browser --no-agents` runs
- **THEN** `agents.yaml` gains that dependency with `skills: [agent-browser]` and `agents: false`, and it is installed

### Requirement: Remove command
`remove <repo-or-path>` SHALL remove the matching repository or path dependency from `agents.yaml`, preserving other keys and comments, then run `update` to prune its installs. A dependency declared only in `config.yaml` MUST fail with a message saying so.

#### Scenario: Machine-level dependency
- **WHEN** `agents-config remove owner/repo` names a dependency declared only in `config.yaml`
- **THEN** it exits with an error stating it is declared in `config.yaml`

### Requirement: List command
`list` SHALL print each merged dependency with its ref (or `live` for paths), its source layer, and its skill and agent selections, followed by the enabled targets or a note that none are declared.

#### Scenario: Dependency from machine configuration
- **WHEN** a dependency is declared only in `config.yaml`
- **THEN** `list` shows it as `from config.yaml`
