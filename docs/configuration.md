# Configuration

[README](../README.md) | [Architecture](../ARCHITECTURE.md) | [Contributing](../CONTRIBUTING.md)

Machine `config.yaml` and project `agents.yaml` share one schema. Both are
optional settings layers, but `install` requires an `agents.yaml` in the current
directory and at least one declared target across the merged configuration.

## Machine Defaults

The machine configuration normally lives at
`~/.config/agents-config/config.yaml`, or
`$XDG_CONFIG_HOME/agents-config/config.yaml` when `XDG_CONFIG_HOME` is set.

For a shared setup across Claude Code, OpenCode, and Codex, use this recommended
machine configuration, which enables per-item Git ignore management:

```yaml
clone_method: https
install_method: copy
manage_gitignore: true
targets:
  interop: true
  claude-interop: true
  opencode-interop: true
  codex-interop: true
```

Project manifests can then declare just dependencies. `agents-config config`
prints the resolved config file and repository cache paths. `--config <dir>`
and `--cache-dir <dir>` override them for one invocation. The repository cache
defaults to `$XDG_CACHE_HOME/agents-config/repos`, or
`~/.cache/agents-config/repos` when unset.

`manage_gitignore` defaults to `false` if omitted. Set it to `false` in a
project's `agents.yaml` to override this machine-wide recommendation.

All destination paths are relative to the current project. There is no separate
global mode: a machine-wide configuration directory can be treated as its own
project with custom destination paths.

## Settings and Layering

```yaml
clone_method: https
install_method: copy
manage_gitignore: true
targets:
  claude: true
dependencies:
  - repo: Dhii/containers
    ref: 0.3.x
    skills: [config-based-modularity]
    agents: false
```

`config.yaml` is merged first, then `agents.yaml`:

- `clone_method` is `https` (default) or `ssh`; project values replace defaults.
- `install_method` is `copy` (default) or `link`.
- `manage_gitignore` is `false` by default. Set it to `true` to have built-in
  handlers maintain managed ignore blocks. As a scalar, a project value in
  `agents.yaml` overrides the machine value in `config.yaml`.
- `targets` merge by name. `true` enables a target, `false` disables an
  inherited one, and a map adds or overrides settings by key.
- Changing a target's explicit `handler` starts its settings fresh. Absent or
  `null` settings use the handler's defaults, so `null` can undo a machine override.
- Dependencies merge by normalized repository or path. A project entry with
  the same key replaces the earlier entry in place; distinct entries append.

Targets run in first-appearance order, machine defaults first. Re-declaring a
target changes its settings, not its position. Dependency order matters too:
when two sources provide the same skill or agent name, the later one wins.

## Repository Dependencies

Each dependency must have exactly one of `repo` or `path`.

`repo` accepts GitHub `owner/repo` shorthand or a repository URI (`https://`,
`git@host:`, `ssh://`, `file://`). A bare filesystem path is rejected; use
`path` for a directory, or `file://` for a local Git repository.

```yaml
dependencies:
  - repo: anthropics/skills
    ref: main
    skills: [skill-creator]
    agents: false
```

`ref` defaults to `main` and accepts a branch, tag, or commit SHA. `update`
resolves it to a commit recorded in the lock; `install` reuses that commit
even if the branch or tag has moved.

`skills` and `agents` accept a list, `"*"`/`true` for everything, or `false` for
nothing. Set `agents: false` for skill-only dependencies. A dependency's
`install_method` overrides the run's method for that dependency.

Sources expose skills under `skills/<name>/SKILL.md` and agents under `agents/`.

## Local Dependencies

To manage skills or agents authored in this repository, keep their source in
`skills/<name>/SKILL.md` or `agents/` and declare `path: .`:

```yaml
dependencies:
  - path: .
  - repo: anthropics/skills
    skills: [skill-creator]
    agents: false
```

`path` resolves relative to the project, or accepts an absolute path. It always
reads the directory live and links by default, so edits are visible immediately.
Set `install_method: copy` on the dependency to copy instead. Paths do not require
Git or a Git repository and do not accept `ref`. They pin nothing independently
of the project's own version control.

The source directories are distinct from destinations such as `.agents/skills`
and `.claude/skills`. Those destinations hold installed copies or links managed
by the tool. Keeping source separate lets you ignore generated installs without
ignoring the files you author. This convention applies to local dependencies;
you don't need source directories when installing only third-party skills.

For a versioned local Git repository, use `repo` with a `file://` URI instead:

```yaml
dependencies:
  - repo: file:///absolute/path/to/repository
    ref: v1.2
```

This uses the repository cache like any other `repo` dependency and does not
include uncommitted working-tree edits. Existing `path` dependencies with `ref`
must either remove `ref` to become live or switch to a repository URI.

## Git Ignore Management

When `manage_gitignore: true`, built-in handlers maintain a marked block per
target in each destination directory's `.gitignore`, listing that target's
lock-owned installed names as literal, directory-relative patterns. Copies and links are covered, including
modified stale items retained during cleanup. Foreign items are not added.
Blocks are updated or removed as ownership changes; text outside the target's
block and blocks for other targets are preserved. Recognized markers with
malformed, overlapping, nested, or duplicate blocks cause an error rather than
being overwritten. With management enabled, names containing a carriage return
or newline, and installs named `.gitignore`, are rejected.

When disabled, handlers leave `.gitignore` files and existing managed blocks
untouched. Those blocks can become stale as installs change or are removed and
remain so until management is re-enabled. Users may clean up stale blocks
manually. If changing a target to a different handler, enable ignore management
for cleanup when the old built-in handler has ignore cleanup pending.

Git ignore rules do not untrack files already in Git, and cannot override an
ignore rule on a parent directory. Later user rules can override a managed
pattern. Review existing tracking and ignore rules when adopting this feature.
The generated `.gitignore` does not ignore itself;
track it if the rules should be shared, along with `agents.yaml`,
`agents-lock.json`, and authored source. Removing the last block can leave an
empty `.gitignore` file; the tool does not delete it.

Ignore management is skipped with a warning for destinations outside the
project, paths with a symlink or non-directory ancestor, and `.gitignore` files
that are symlinks or not regular files. Installation can still take place at
those destinations; manage their ignore rules separately. Skipped updates are
retained for retry. A switch to a different handler is blocked while the old
built-in handler has pending ignore cleanup or retains modified owned installs;
resolve the reported paths or warnings and retry the switch.
Custom handlers are responsible for their own ignore rules.

## Targets and Interop

Each target uses the handler with its name unless it specifies `handler:`.

| Handler | Default skill path | Default agent path |
|---|---|---|
| `interop` | `.agents/skills` | `.agents/agents` |
| `claude` | `.claude/skills` | `.claude/agents` |
| `opencode` | `.opencode/skills` | `.opencode/agents` |
| `codex` | `.codex/skills` | `.codex/agents` |
| `claude-interop` | `.claude/skills` | `.claude/agents` |
| `opencode-interop` | `.opencode/skills` | `.opencode/agents` |
| `codex-interop` | `.codex/skills` | `.codex/agents` |

`*-interop` variants work alongside `interop`. Put `interop` first so its
entries are available when the variants inspect the shared directories.

OpenCode and Codex read `.agents/skills` natively. Their interop variants leave
skills already there alone, so skill-only installs need neither `.opencode`
nor `.codex` directories. Claude Code gets one link per shared skill, not a
symlink for the entire skills directory. For example:

```text
.claude/skills/gr-readme -> ../../.agents/skills/gr-readme
```

For kinds a harness cannot read directly from the shared `.agents/skills` or
`.agents/agents` directory, `unsupported: symlink` (default)
links each requested item's shared entry individually. Entries in the shared
directories that `agents.yaml` doesn't request, such as hand-written ones or
those another tool generates, are not linked or recorded unless the target's
`link` setting names them (see below).
`unsupported: install` installs the requested items as the plain handler would,
following `install_method`. Requested items absent from shared directories are
also installed normally. `interop_paths` overrides where shared content is
looked up. Each variant extends its plain handler and inherits settings such
as `paths`.

`link` exposes selected unmanaged entries from the shared directories, such as
skills generated by OpenSpec (`openspec init --tools agents`):

```yaml
targets:
  interop: true
  claude-interop:
    link:
      skills: [openspec-*]
      agents: [reviewer]
```

Each list holds names or globs (`*` matches any run of characters, `?` one
character); agents are named without their `.md` extension. Matching entries
are handled like requested items of that kind: linked under
`unsupported: symlink`, or installed following `install_method` under
`unsupported: install`. They are recorded in the target's lock state with
`declared: true` and covered by the managed `.gitignore` block. Removing a
name from `link` removes what it exposed, never the shared entry itself. A
pattern that matches no entry produces a warning, since the tool that writes it
may not have run yet. `link` is rejected for kinds the harness reads natively
(OpenCode and Codex skills) and by `codex-interop`.

`codex-interop` defaults to, and only permits, `unsupported: install`.
Both Codex handlers skip agents because they require TOML and conversion is
not implemented. Actual Codex project custom-agent discovery remains
unverified. Other handlers install agents without conversion; OpenCode and
Claude Code formats differ.

Ownership is per installed item. Unmanaged content can coexist in destination
directories and is protected. Empty destinations are not created when nothing
needs installing; pruning may leave previously created directories empty.
In-project links are relative; links into machine-local dependency caches are
absolute.

### Custom Destinations

Reuse the `interop` handler to install flat into a directory treated as its own
project, such as a personal agent configuration repository:

```yaml
targets:
  interop: false
  claude-interop: false
  opencode-interop: false
  codex-interop: false
  agents-root:
    handler: interop
    paths:
      skills: skills
      agents: agents
```

Disable inherited targets that should not run in that project. Avoid overlapping
target paths: built-in handlers treat another target's installed items as foreign.

## Sync and Lockfile Behavior

`agents-lock.json` records winning sources and per-target installation state.
Built-in handlers update or remove only lock-owned paths. Existing unmanaged
paths are left alone and conflicts are reported.

`install` uses locked dependency declarations and commits. With no lockfile,
it resolves the merged dependencies and creates one. `update` resolves the
current merged declarations, writes the lock only if its contents change,
then installs. Commit the lockfile for reproducible Git dependencies.

Changes to dependency declarations in either settings layer require `update`;
`install` aborts with a hint instead of silently changing resolutions. Target
settings and the run's install method can change without updating dependencies.
Live `path` dependencies remain live and reject `ref`; use a `file://` repository
dependency for a versioned local source.
Older locks without dependency resolutions require one `update`, preserving
their existing ownership records. `add` and `remove` run a full update after
editing the manifest, so they may also advance other dependencies.

Desired managed copies are restored when missing or modified. Stale installs
are pruned when selections, dependencies, targets, or destination paths change;
stale modified copies are preserved with a warning. A later source taking over
the same installed name updates that destination rather than removing it.

`install_method: link` links individual items instead of copying. Git-backed
sources use immutable cached snapshots, so another project's update cannot
change an existing linked install. Git snapshots exclude `export-ignore` files.
Dependency resolution failures abort before installed content is changed.
See [Architecture](../ARCHITECTURE.md#ownership-and-cleanup) for ownership,
hashing, and cleanup details.

## Migrating from agentdeps

The dependency shape retains compatibility with `agentdeps`' `agents.yaml`.
Legacy machine config keys `agents` and `custom_agents` are rejected with a
hint to use `targets`; they are not silently translated.

If the new config directory has no `config.yaml`, but
`$XDG_CONFIG_HOME/agentdeps/config.yaml` exists (normally
`~/.config/agentdeps/config.yaml`), it is read as a fallback. That file must
use the current schema too.
