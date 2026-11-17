# Reading install and update output

Typical run:

```text
  targets: interop, claude-interop
  ⚠ no agents found in path:../a (agents/ does not exist)
    skills/foo: path:../b replaces path:../a (later dependency wins)
    [interop] added 1 item
    ⚠ [interop] .agents/skills/bar already exists and isn't tracked by agents-config — left untouched
    [claude-interop] added 3 items
    ⚠ [claude-interop] link.skills: 'openspec-*' matches nothing in .agents/skills

Install complete
```

Lines in `[target]` brackets belong to one target. `added`, `updated`, and
`removed` are counts of managed items; `updated` also covers restoring a
managed copy that was missing or edited.

## Warnings and what to tell the user

| Output | Meaning | Action |
|---|---|---|
| `<a> replaces <b> (later dependency wins)` | Two dependencies provide the same name; only the later one in merged order (machine file first) is installed. | Confirm the winner is intended. To keep the other, reorder, or narrow one dependency's `skills`/`agents` list, then `update`. |
| `<path> already exists and isn't tracked by agents-config — left untouched` | Conflict: something the tool didn't install (hand-written, another tool's, or from a lost state file) occupies the destination. Nothing was overwritten. | Ask the user. If the existing item should be replaced, they remove or rename it and re-run `install`. If it is theirs, drop that name from the dependency's selection or leave it. Never delete it on your own. |
| `<path> is no longer desired but was modified since install — left in place` | A managed copy was pruned from the manifest but edited locally, so it was preserved and remains owned. | Ask whether the edits matter. If not, the user removes it and re-runs `install`; if so, move it into an authored source such as `skills/` with a `path: .` dependency. |
| `link.<kind>: '<pattern>' matches nothing in <dir>` | A `link` pattern found no entry yet. Not an error. | Usually the generating tool (e.g. OpenSpec) hasn't run yet. Run it, then `install` again. Check the pattern spelling. |
| `skills not found in <source> under <dir>: <names>` / `agents not found …` | Selected names aren't in that folder of the source at the resolved revision. | Check spelling and the `ref`. If the source keeps them elsewhere, set the dependency's `paths` (see the manifest reference) and `update`. |
| `no skills found in <source> (<dir> does not exist)` / `no agents found …` | The source has no folder at the searched path. | If the source has none of that kind, set `skills: false` / `agents: false`. If it keeps them elsewhere (e.g. skills at the repository root), set `paths`, e.g. `paths: { skills: . }`, and `update`. |
| `no skills found in <source> (no SKILL.md in any subdirectory of <dir>)` / `no agents found … (no agent subdirectories or .md files in <dir>)` | The folder exists but holds nothing installable at its top level. | Point `paths` at the folder that actually contains the `<name>/SKILL.md` directories (or agents). |
| `skipped .gitignore management …` | `manage_gitignore` couldn't update an ignore file (outside the project, symlinked ancestor, or a non-regular `.gitignore`). Install still happened; the update is retried later. | Manage those ignore rules by hand. |
| `moving install state from agents-lock.json to …` | One-time migration of an older lock's install state into the state file. | None; commit the slimmer lock. |
| `No dependencies defined.` | Informational. Normal for a link-only manifest. | None. |

## Errors (run aborts, nothing changed)

| Error | Fix |
|---|---|
| `Dependencies differ from agents-lock.json. Run agents-config update.` | Dependency declarations changed in either file; run `update`. |
| `This lockfile has no pinned dependency resolutions. Run agents-config update.` | Older lock; run `update` once. |
| `No targets declared in config.yaml or agents.yaml …` | Declare targets (see the SKILL.md target table). |
| `Failed to cache <source>: ref '<ref>' not found …` | Wrong `ref`, or no access to the repository. |
| `<file>: invalid …` / `needs exactly one of 'repo' or 'path'` | Manifest schema error; fix the named field. |
| `'paths.<kind>' must be a folder inside the dependency, relative to its root` / `… resolves outside the dependency` | `paths` is absolute, uses `..`, or is a symlink leaving the source; use a folder inside it. |
| `unsupported lockfile format` | Lock written by an incompatible version; upgrade agents-config. |
| `Target '<name>' cannot switch handlers: …` | The old handler still holds cleanup (modified installs or pending `.gitignore` work); resolve the reported paths, enable `manage_gitignore` if asked, and retry. |
