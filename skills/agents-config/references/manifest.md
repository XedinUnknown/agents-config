# Manifest reference

Condensed from the agents-config [README](https://github.com/XedinUnknown/agents-config/blob/0.1.x/README.md)
and [Configuration](https://github.com/XedinUnknown/agents-config/blob/0.1.x/docs/configuration.md)
docs. When something here is unclear or seems out of date, read those or run
`agents-config <command> --help`; they are authoritative.

## Files and layering

- Machine defaults: `~/.config/agents-config/config.yaml`
  (`$XDG_CONFIG_HOME/agents-config/config.yaml`; `agents-config config` prints
  the resolved path). Optional.
- Project manifest: `agents.yaml` in the project root. `install` requires it in
  the current directory and installs relative to that directory. There is no
  global mode; to install into a fixed directory, run from that directory as
  its own project.
- Both share one schema and merge machine first, project second:
  - scalars (`clone_method`, `install_method`, `manage_gitignore`,
    `state_dir`) are replaced by the project value;
  - `targets` merge by name;
  - `dependencies` merge by normalized repo or path: a project entry for the
    same source replaces the machine one in place; others append.
- `--config <dir>` and `--cache-dir <dir>` override locations for one run.

## Top-level settings

| Key | Values | Default |
|---|---|---|
| `clone_method` | `https`, `ssh` | `https` |
| `install_method` | `copy`, `link` | `copy` |
| `manage_gitignore` | `true`, `false` | `false` |
| `state_dir` | directory relative to project | `.agents/agents-config` |
| `targets` | map of name → `true` / `false` / settings map | none |
| `dependencies` | list | none |

## Targets

`true` enables, `false` disables an inherited target, a map adds or overrides
settings by key. A target uses the handler with its own name unless it sets
`handler:`. Settings left out or `null` use the handler's defaults, so `null`
undoes a machine override. Targets run in first-appearance order, machine file
first.

| Handler | Skills path | Agents path |
|---|---|---|
| `interop` | `.agents/skills` | `.agents/agents` |
| `claude` / `claude-interop` | `.claude/skills` | `.claude/agents` |
| `opencode` / `opencode-interop` | `.opencode/skills` | `.opencode/agents` |
| `codex` / `codex-interop` | `.codex/skills` | `.codex/agents` |

- OpenCode and Codex read `.agents/skills` natively; their `*-interop`
  variants leave those skills alone. Claude Code does not, so
  `claude-interop` creates one relative link per shared skill, e.g.
  `.claude/skills/gr-readme -> ../../.agents/skills/gr-readme`.
- `*-interop` settings: `unsupported: symlink` (default; link requested
  items from `.agents/`) or `install` (install them as the plain handler
  would); `interop_paths` overrides where shared content is looked up; `paths`
  is inherited from the plain handler.
- `codex-interop` only permits `unsupported: install`. Both Codex handlers skip
  agents (TOML conversion not implemented).
- Agents are copied without format conversion; OpenCode and Claude Code agent
  formats differ, so an agent must already suit its destination.
- Avoid overlapping target paths: a target treats another target's installs
  as foreign.

Recommended machine setup for all three tools:

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

### `link`: expose entries other tools wrote to `.agents/`

```yaml
targets:
  claude-interop:
    link:
      skills: [openspec-*]
      agents: [reviewer]
```

- Names or globs (`*` any run of characters, `?` one character); agents are
  named without `.md`.
- Needs no dependencies and no `interop` target.
- Matches are linked (or installed under `unsupported: install`), recorded in
  install state, and pruned when a name leaves `link`. The shared entry
  itself is never touched.
- A pattern that matches nothing warns rather than fails, so the manifest can
  be committed before the other tool runs.
- Rejected for kinds the harness reads natively (OpenCode and Codex skills)
  and by `codex-interop`.

### Custom destinations

Reuse a handler under a new name with its own paths, and disable inherited
targets that shouldn't run there:

```yaml
targets:
  interop: false
  agents-root:
    handler: interop
    paths:
      skills: skills
      agents: agents
```

## Dependencies

Each entry has exactly one of `repo` or `path`.

```yaml
dependencies:
  - path: .                      # this project's skills/ and agents/
  - repo: anthropics/skills      # owner/repo, https://, git@host:, ssh://, file://
    ref: main                    # branch, tag, or commit; default main
    skills: [skill-creator]      # list, "*"/true for all, false for none
    agents: false
    install_method: copy         # optional per-dependency override
```

- Sources expose `skills/<name>/SKILL.md` and `agents/`.
- `repo` rejects bare filesystem paths; use `path`, or `file://` for a
  versioned local Git repository (uncommitted edits are not included).
- `path` is resolved relative to the project (or absolute), read live, linked
  by default, needs no Git, and rejects `ref`.
- When two dependencies provide the same skill or agent name, the later one in
  merged order wins.

### Pinning

`update` resolves each `ref` to a commit and records it in `agents-lock.json`;
`install` reuses that commit even if the branch or tag moves. To stop tracking
a moving default branch, set `ref` to a release branch, tag, or commit SHA,
then run `update`.

## Commands

| Command | Action |
|---|---|
| `install` | Install locked commits; resolve and create a lock if absent |
| `update` | Resolve dependencies, update the lock if needed, then install |
| `add <repo>` | Add or change a dependency, then update and install |
| `remove <repo>` | Remove a dependency, then update and prune its installs |
| `list` | List dependencies, their configuration source, and targets |
| `config` | Print resolved config and cache paths |

`add` flags: `--ref <ref>`, `--skill <name>` (repeatable), `--agent <name>`
(repeatable), `--all-skills`, `--all-agents`, `--no-skills`, `--no-agents`.
`add` and `remove` run a full update, so they may also advance other
dependencies.

## Git and per-machine state

- Commit `agents.yaml`, `agents-lock.json`, and authored sources. The lock
  depends only on dependency declarations, so it is the same on every machine.
- Install state (what each target installed) lives in `state.json` under
  `state_dir`. It differs between machines, ignores itself via a `.gitignore`
  of `*`, and is removed once nothing is installed. Changing `state_dir` does
  not move existing state; until moved, earlier installs are treated as
  unmanaged.
- `manage_gitignore: true` makes built-in handlers maintain a marked block in
  each destination's `.gitignore` listing only their installed items.
  Hand-written items stay visible. Track those `.gitignore` files if the rules
  should be shared. Ignore rules don't untrack files already in Git and can't
  override an ignore rule on a parent directory.
