# target-handlers Specification

## Purpose
Defines how enabled targets map to handler code, how handlers are validated and run, how removed or switched targets are cleaned up, and how handlers are extended.

## Requirements

### Requirement: Targets must be declared
`install` SHALL fail when no layer declares `targets`; there is no implicit default target.

#### Scenario: Manifest without targets
- **WHEN** neither `config.yaml` nor `agents.yaml` has a `targets` key
- **THEN** `install` fails with an example declaring `interop: true`

### Requirement: Handler resolution
Each enabled target SHALL use the handler with its own name unless its settings name another `handler`. The built-in handlers are `interop`, `claude`, `opencode`, `codex`, `claude-interop`, `opencode-interop`, and `codex-interop`. An unknown handler MUST fail the run before anything is fetched or changed.

#### Scenario: Custom target reusing a built-in
- **WHEN** target `agents-root` sets `handler: interop`
- **THEN** it is installed by the `interop` handler with its own settings

#### Scenario: Unknown target
- **WHEN** target `foo` is enabled and no `foo` handler exists
- **THEN** the run fails before fetching, suggesting `handler:`

### Requirement: Validation before mutation
Every enabled target's handler SHALL validate the target's settings before any dependency is fetched or any file changes. Absent or `null` settings MUST mean the handler's default.

#### Scenario: Invalid paths setting
- **WHEN** a target sets `paths: [a]`
- **THEN** the run fails before fetching with an error naming the target

### Requirement: Handler contract
A handler SHALL receive the project directory, target name, whether the target is enabled, its merged settings, the plan of requested skills and agents, the run's install method, the `manage_gitignore` setting, and its previous state record, and SHALL report added, updated, removed, and unchanged items and warnings. Handler state MUST be saved even when a later handler fails.

#### Scenario: Later handler fails
- **WHEN** the second of two targets throws during synchronization
- **THEN** the first target's updated state is still written to the state file

### Requirement: Cleanup of removed or switched targets
A target recorded in the install state that is disabled, absent from configuration, or now uses a different handler SHALL be passed to its recorded handler with nothing requested and `enabled: false`, before any install runs. If the recorded handler is unavailable, the run MUST abort. A handler switch MUST abort when the old handler reports blocked cleanup or retains state.

#### Scenario: Target disabled
- **WHEN** `claude-interop` was installed and is now set to `false`
- **THEN** its handler removes what it installed and its state record is deleted

#### Scenario: Recorded handler no longer exists
- **WHEN** the state records a target installed by handler `custom` and no `custom` handler is composed
- **THEN** the run aborts, naming the state file

### Requirement: Built-in handler destinations
The built-in flat handlers SHALL default to these skill and agent directories: `interop` `.agents/skills` and `.agents/agents`; `claude` `.claude/skills` and `.claude/agents`; `opencode` `.opencode/skills` and `.opencode/agents`; `codex` `.codex/skills` and `.codex/agents`. A target's `paths` MAY override either. The `codex` handlers MUST skip agents with one warning per run, because Codex agents are TOML and conversion is not implemented.

#### Scenario: Codex receives agents
- **WHEN** the plan contains agents and the `codex` target runs
- **THEN** no agents are installed and one warning states the count skipped

### Requirement: Handlers are extensible modules
Handlers SHALL be container definitions keyed `handler/<name>`, so a provider passed to `bootstrapApp({ modules })`, composed after the built-ins, MAY add a handler or override a built-in. Overriding a plain harness handler MUST also change its `*-interop` variant.

#### Scenario: Module overrides the claude handler
- **WHEN** a module overrides `handler/claude`
- **THEN** both `claude` and `claude-interop` targets use the overriding implementation
