# settings-layers Specification

## Purpose
Defines the shared settings schema of the machine `config.yaml` and the project `agents.yaml`, how the two layers are located, validated, and merged into the settings a run uses.

## Requirements

### Requirement: Shared layer schema
The machine `config.yaml` and project `agents.yaml` SHALL share one schema with the top-level keys `clone_method` (`https` or `ssh`), `install_method` (`copy` or `link`), `manage_gitignore` (boolean), `state_dir` (string), `targets` (map), and `dependencies` (list). Invalid values MUST be rejected with an error naming the source file.

#### Scenario: Invalid clone method
- **WHEN** a layer sets `clone_method: ftp`
- **THEN** loading fails with an error naming the file and stating that the value must be `ssh` or `https`

#### Scenario: State directory is the project itself
- **WHEN** a layer sets `state_dir: .`
- **THEN** loading fails, because the state directory must differ from the project directory

### Requirement: Layer merge order and precedence
Layers SHALL merge in the order `config.yaml`, then `agents.yaml`. Scalars MUST be replaced by later layers; defaults are `clone_method: https`, `install_method: copy`, `manage_gitignore: false`, and `state_dir: .agents/agents-config`.

#### Scenario: Project overrides a machine scalar
- **WHEN** `config.yaml` sets `manage_gitignore: true` and `agents.yaml` sets `manage_gitignore: false`
- **THEN** the merged setting is `false`

#### Scenario: No layer sets a scalar
- **WHEN** neither layer sets `install_method`
- **THEN** the merged install method is `copy`

### Requirement: Target merging
`targets` entries SHALL merge by name: `true` enables a target, `false` disables an inherited one, and a map enables the target and merges its settings recursively by key. A map naming a `handler` different from the inherited one MUST start that target's settings fresh. Handler defaults MUST NOT be merged into settings.

#### Scenario: Partial override of inherited settings
- **WHEN** `config.yaml` defines target `agents-root` with `paths: { skills: skills, agents: agents }` and `agents.yaml` sets `agents-root: { paths: { agents: other } }`
- **THEN** the merged target has `paths.skills: skills` and `paths.agents: other`

#### Scenario: Handler switch resets settings
- **WHEN** a later layer gives an inherited target a different `handler`
- **THEN** the earlier layer's settings for that target are discarded

### Requirement: Target order
Enabled targets SHALL run in first-appearance order across layers, starting with `config.yaml`. Re-declaring an inherited target MUST NOT move it.

#### Scenario: Project re-declares a machine target
- **WHEN** `config.yaml` declares `interop` then `claude-interop`, and `agents.yaml` declares `claude-interop` then `interop`
- **THEN** `interop` still runs before `claude-interop`

### Requirement: Dependency merging
Dependencies SHALL be keyed by normalized repository (case-insensitive, without a trailing `.git`) or normalized path. A later layer's entry with the same key MUST replace the earlier entry in its original position; distinct entries append.

#### Scenario: Project replaces a machine dependency
- **WHEN** `config.yaml` declares `Owner/Repo` first of two dependencies and `agents.yaml` declares `owner/repo.git`
- **THEN** the merged list keeps two dependencies, with the project's entry first

### Requirement: Machine configuration location
The machine configuration directory SHALL be the `--config` override when given; otherwise `$XDG_CONFIG_HOME/agents-config` (default `~/.config/agents-config`). A missing `config.yaml` MUST be treated as an empty layer.

#### Scenario: No machine configuration
- **WHEN** the configuration directory has no `config.yaml`
- **THEN** the machine layer is empty and the run continues with project settings
