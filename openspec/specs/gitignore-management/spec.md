# gitignore-management Specification

## Purpose
Defines the opt-in per-target `.gitignore` blocks that built-in handlers maintain for the items they own.

## Requirements

### Requirement: Opt-in management
Built-in handlers SHALL maintain ignore blocks only when the merged `manage_gitignore` is `true`; the default is `false`. When `false`, they MUST leave `.gitignore` files and existing managed blocks untouched.

#### Scenario: Management disabled
- **WHEN** `manage_gitignore` is `false` and items are installed or removed
- **THEN** no `.gitignore` file is created or changed

### Requirement: Managed block contents
When enabled, each target SHALL own one block per destination directory, delimited by `# BEGIN agents-config MANAGED BLOCK (<id>)` and `# END agents-config MANAGED BLOCK (<id>)`, where `<id>` is the base64url target name. The block MUST list that target's owned installed names, including retained modified items, as escaped patterns anchored to the directory, and MUST NOT list foreign items.

#### Scenario: Hand-written skill beside installed ones
- **WHEN** `.claude/skills` holds an installed `foo` and a hand-written `mine`
- **THEN** the block lists `/foo` and not `mine`

### Requirement: Block updates preserve other content
Updating a target's block SHALL preserve text outside it and other targets' blocks. The block MUST be removed when the target owns nothing in that directory; the `.gitignore` file itself is not deleted.

#### Scenario: Last item removed
- **WHEN** a target's only item in a directory is pruned
- **THEN** its block is removed and user-written lines remain

### Requirement: Malformed blocks abort
Recognized managed markers that are malformed, duplicated, nested, or overlapping SHALL cause an error rather than being overwritten. With management enabled, item names containing a carriage return or newline, or named `.gitignore`, MUST be rejected.

#### Scenario: Unterminated block
- **WHEN** a `.gitignore` contains a BEGIN marker without its END marker
- **THEN** synchronization fails with a malformed block error

### Requirement: Unsafe destinations are skipped and retried
Ignore management SHALL be skipped with a warning for destinations outside the project, with a symlink or non-directory ancestor, or whose `.gitignore` is a symlink or not a regular file, and the skipped directories MUST be retained in state for retry. Ignore synchronization MUST also run after an installation error.

#### Scenario: Destination outside the project
- **WHEN** a target's `paths.skills` is `../elsewhere`
- **THEN** items install there and a warning says ignore management was skipped

### Requirement: Handler switch requires finished ignore cleanup
A handler switch SHALL be blocked while the old built-in handler has pending ignore cleanup, or retains ignore bookkeeping while management is disabled.

#### Scenario: Switch with management disabled
- **WHEN** a target with managed blocks switches handler while `manage_gitignore` is `false`
- **THEN** the run aborts, asking to enable `manage_gitignore` and retry
