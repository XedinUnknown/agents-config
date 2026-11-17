# dependency-resolution Specification

## Purpose
Defines how declared dependencies are validated, fetched, discovered, selected, pinned, and reduced to one winning source per skill or agent name.

## Requirements

### Requirement: Dependency declaration
Each dependency SHALL declare exactly one of `repo` or `path`. `repo` MUST be a repository URI (`https://`, `ssh://`, `file://`, `git@host:`) or GitHub `owner/repo` shorthand; a bare filesystem path MUST be rejected with a hint to use `path` or a `file://` URI. `ref` defaults to `main` and MUST be rejected on `path` dependencies.

#### Scenario: Bare path given as repository
- **WHEN** a dependency declares `repo: ../skills`
- **THEN** loading fails with a hint to use `path:` or a `file://` URI

#### Scenario: Ref on a path dependency
- **WHEN** a dependency declares `path: .` and `ref: v1`
- **THEN** loading fails, stating that paths are always live

### Requirement: Selections
`skills` and `agents` SHALL accept a list of names, `"*"` or `true` for everything, or `false` for nothing; an omitted selection means everything. Requested names that are not discovered MUST produce a warning naming them.

#### Scenario: Missing selected skill
- **WHEN** a dependency selects `skills: [a, b]` and only `a` exists
- **THEN** `a` is selected and a warning lists `b` as not found

### Requirement: Source discovery
Skills SHALL be the immediate subdirectories of the dependency's skills folder that contain `SKILL.md`. Agents SHALL be the immediate subdirectories or `.md` files of its agents folder, named without the `.md` extension. The folders default to `skills` and `agents` and MAY be overridden by `paths`, which MUST stay inside the dependency, including after resolving symlinks. There is no fallback layout.

#### Scenario: Skills at the repository root
- **WHEN** a dependency sets `paths: { skills: . }` and the root holds `devto-article/SKILL.md`
- **THEN** `devto-article` is discovered as a skill

#### Scenario: Source folder escapes the dependency
- **WHEN** `paths.skills` is a symlink resolving outside the dependency
- **THEN** resolution fails with an error naming the dependency

#### Scenario: Nothing discovered
- **WHEN** a dependency that does not set `skills: false` yields no skills
- **THEN** a warning says whether the folder is missing or has no `SKILL.md` subdirectories

### Requirement: Repository fetching
Repository dependencies SHALL be cloned or updated in the repository cache (`--cache-dir`, else `$XDG_CACHE_HOME/agents-config/repos`, else `~/.cache/agents-config/repos`) and installed from an immutable per-commit snapshot extracted with `git archive`, so `export-ignore` files are excluded. Shorthand repositories MUST resolve to GitHub over the configured `clone_method`. Git MUST be required only for repository dependencies.

#### Scenario: Shorthand over SSH
- **WHEN** `clone_method` is `ssh` and a dependency declares `repo: owner/name`
- **THEN** it is fetched from `git@github.com:owner/name.git`

#### Scenario: Path-only project without Git
- **WHEN** every dependency is a `path` dependency and Git is not installed
- **THEN** installation proceeds

### Requirement: Live path dependencies
`path` dependencies SHALL resolve against the project directory (or be absolute), be read live from disk without Git operations, and install by link unless the dependency sets `install_method: copy`. A path that is not a directory MUST fail resolution.

#### Scenario: Project's own skills
- **WHEN** `agents.yaml` declares `path: .` and the project has `skills/foo/SKILL.md`
- **THEN** `foo` is installed as a link to the live folder

### Requirement: Pinned resolution
`install` SHALL reuse the commits recorded in `agents-lock.json`; `update` SHALL resolve current refs. With no lockfile, `install` MUST resolve and create one. `install` MUST abort before any change when the merged dependency declarations differ from the locked ones, or when the lock has no dependency resolutions, with a hint to run `update`.

#### Scenario: Branch moved upstream
- **WHEN** a locked dependency's branch has new commits and `install` runs
- **THEN** the locked commit is installed

#### Scenario: Declarations edited
- **WHEN** a dependency's selection changes in `agents.yaml` and `install` runs
- **THEN** it aborts with "Dependencies differ from agents-lock.json. Run agents-config update."

### Requirement: Failures abort before changes
Every dependency SHALL be fetched and discovered before any target is synchronized. A fetch or discovery failure MUST abort the run without changing installed content.

#### Scenario: Repository unavailable
- **WHEN** one dependency cannot be cloned
- **THEN** the run fails and nothing previously installed is pruned

### Requirement: Last dependency wins
When multiple dependencies provide the same skill or agent name, the later one in merged order SHALL win. Only the winner is installed, and each replacement MUST be reported.

#### Scenario: Two dependencies provide the same skill
- **WHEN** dependencies A then B both provide skill `x`
- **THEN** B's `x` is installed and output reports that B replaces A (later dependency wins)
