# lock-and-state Specification

## Purpose
Defines the committed `agents-lock.json`, which is identical across machines, and the per-machine install state that records what each target installed.

## Requirements

### Requirement: Project lockfile
`agents-lock.json` next to `agents.yaml` SHALL be a version 3 document recording every merged dependency declaration with its resolved commit (including dependencies that lose collisions or select nothing) and the winning source per skill and agent name. It MUST depend only on dependency declarations, not on targets.

#### Scenario: Same project on two machines
- **WHEN** two machines with different targets install the same `agents.yaml`
- **THEN** both produce identical `agents-lock.json` content

### Requirement: Lock writes
The lockfile SHALL be written before any target is synchronized, MUST NOT be rewritten when its content is unchanged, and MUST be removed when it would hold no dependencies or items.

#### Scenario: Unchanged second run
- **WHEN** `install` runs twice with no changes
- **THEN** the second run leaves `agents-lock.json` untouched

### Requirement: Install state
Each project SHALL keep this machine's install state in `<state_dir>/state.json` (default `.agents/agents-config/state.json`), with one record per target naming the handler that installed it and that handler's opaque state. The state directory MUST contain a `.gitignore` of `*`, and the state file, the generated ignore file, and the empty directory MUST be removed once no target has state.

#### Scenario: First install
- **WHEN** a target installs its first item
- **THEN** `.agents/agents-config/state.json` and `.agents/agents-config/.gitignore` containing `*` are created

#### Scenario: Last target cleaned up
- **WHEN** every target's state becomes empty
- **THEN** the state file and its directory are removed

### Requirement: Unreadable records abort
A lockfile or state file with an unknown format SHALL abort the run rather than being treated as empty, so that previous installs are never reclassified as foreign content.

#### Scenario: Unknown lock version
- **WHEN** `agents-lock.json` has `version: 9`
- **THEN** the run fails with an unsupported lockfile format error

### Requirement: Version 2 lock migration
A version 2 lock's `targets` SHALL seed the install state when no state file exists; an existing state file MUST win. A changed `state_dir` MUST warn when state exists only at the default location.

#### Scenario: Upgrading from a version 2 lock
- **WHEN** a version 2 lock with `targets` is present and no state file exists
- **THEN** its targets are moved into the state file and the lock is rewritten as version 3

#### Scenario: Relocated state directory
- **WHEN** `state_dir` is set to `agents-config` and state exists only at `.agents/agents-config`
- **THEN** a warning says previously installed items are treated as foreign until the state is moved
