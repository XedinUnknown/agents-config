# interop-targets Specification

## Purpose
Defines the `*-interop` handlers, which make a harness see items in the shared `.agents/` directories without duplicating them.

## Requirements

### Requirement: Variants extend their plain handler
`claude-interop`, `opencode-interop`, and `codex-interop` SHALL resolve the corresponding plain handler at run time and delegate installation to it, so its settings, directories, and install method apply. They MUST only decide which items to hand it.

#### Scenario: Custom destination on an interop variant
- **WHEN** `claude-interop` sets `paths.skills: custom`
- **THEN** its links are created under `custom`

### Requirement: Native kinds are left alone
For kinds a harness reads natively from the shared directories (OpenCode and Codex skills), requested items already present there SHALL NOT be mirrored. Requested items missing from the shared directories MUST be installed normally.

#### Scenario: OpenCode skills already shared
- **WHEN** `interop` installed skill `foo` and `opencode-interop` runs
- **THEN** nothing is placed in `.opencode/skills`

### Requirement: Unsupported kinds
For kinds the harness cannot read from the shared directories, `unsupported: symlink` (the default except for `codex-interop`) SHALL link each requested item's shared entry individually, and `unsupported: install` SHALL install the requested items as the plain handler would. `codex-interop` MUST default to and only permit `install`. Shared entries are read from disk when the target runs, so `interop` must run earlier.

#### Scenario: Claude per-skill links
- **WHEN** `interop` then `claude-interop` run for skill `foo`
- **THEN** `.claude/skills/foo` is a link to the shared entry, not a copy

#### Scenario: Symlink on codex-interop
- **WHEN** `codex-interop` sets `unsupported: symlink`
- **THEN** validation fails before fetching

### Requirement: Unrequested shared entries
Shared entries not requested by the plan SHALL NOT be linked or recorded unless the target's `link` setting names them by name or glob (`*`, `?`) per kind; matches are handled like requested items and recorded with `declared: true`. A pattern matching nothing MUST warn rather than fail. `link` MUST be rejected for native kinds and by `codex-interop`. Removing a name from `link` removes only the exposure, never the shared entry.

#### Scenario: Exposing generated skills to Claude Code
- **WHEN** `claude-interop` sets `link: { skills: [openspec-*] }` and `.agents/skills/openspec-propose` exists
- **THEN** `.claude/skills/openspec-propose` links to it and is recorded with `declared: true`

#### Scenario: Generator has not run yet
- **WHEN** a `link` pattern matches no shared entry
- **THEN** the run warns and continues

### Requirement: Shared location override
`interop_paths` SHALL override where a variant looks up shared skills and agents, defaulting to `.agents/skills` and `.agents/agents`.

#### Scenario: Non-standard shared directory
- **WHEN** `claude-interop` sets `interop_paths.skills: shared`
- **THEN** shared skills are read from `shared`
