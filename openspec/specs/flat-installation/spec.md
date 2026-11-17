# flat-installation Specification

## Purpose
Defines how the built-in handlers place items flat in destination directories, track ownership per item, and protect content they do not own.

## Requirements

### Requirement: Flat placement
Built-in handlers SHALL install each item as an immediate child of its destination directory (`<dir>/<skill>` or `<dir>/<agent>` or `<dir>/<agent>.md`), never under a nested managed directory, so harnesses that scan only immediate children discover it.

#### Scenario: Claude Code discovery
- **WHEN** skill `foo` is installed by the `claude` target
- **THEN** it exists at `.claude/skills/foo/SKILL.md`

### Requirement: Per-item ownership
Built-in handlers SHALL record every installed path, relative to the project, in their state, and MUST only overwrite or remove recorded paths. An existing unrecorded path MUST be left untouched and reported as a warning, even when it is desired.

#### Scenario: Hand-written skill with the same name
- **WHEN** `.claude/skills/foo` exists unrecorded and a dependency provides `foo`
- **THEN** the existing directory is left untouched and a warning says it isn't tracked

### Requirement: Copy and link methods
Items SHALL install by the dependency's `install_method` if set, otherwise by the run's. Copies MUST be tracked by a SHA-256 over sorted relative paths and file contents. Links to content inside the project MUST be relative; links into the machine-local repository cache MUST be absolute.

#### Scenario: Interop mirror link
- **WHEN** `claude-interop` links shared skill `foo`
- **THEN** `.claude/skills/foo` points to `../../.agents/skills/foo`

### Requirement: Repair of desired copies
A desired, owned copy that is missing or whose content hash differs SHALL be restored from source and reported as updated.

#### Scenario: Locally edited copy
- **WHEN** an owned, still-desired copy has been edited
- **THEN** the next install restores the source content

### Requirement: Pruning
An owned path no longer desired SHALL be removed and dropped from state, unless it was modified since install (a copy whose hash differs, or a link replaced by a real file); then it MUST be kept, still owned, with a warning. Destination directories MUST NOT be created when nothing needs installing.

#### Scenario: Selection removed
- **WHEN** skill `foo` is removed from a dependency's selection and `update` runs
- **THEN** its owned, unmodified install is removed

#### Scenario: Stale modified copy
- **WHEN** a no-longer-desired owned copy was edited locally
- **THEN** it is left in place, kept in state, and a warning is reported

#### Scenario: Skill-only dependency
- **WHEN** no agents are desired for a target
- **THEN** no agents directory is created
