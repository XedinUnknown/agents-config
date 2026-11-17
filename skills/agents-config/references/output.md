# Reading install and update output

Typical run:

```text
  targets: interop, claude-interop
  ⚠ no agents found in path:../a (no agents/ directory)
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
| `skills not found in <source>: <names>` / `agents not found …` | Selected names don't exist in that source at the resolved revision. | Check spelling and the source's `skills/<name>/SKILL.md` layout, or the `ref`. |
| `no skills found in <source>` / `no agents found in <source>` | The source has no `skills/` or `agents/` directory. | Harmless when the source has none; set `agents: false` (or `skills: false`) to make intent explicit. |
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
| `unsupported lockfile format` | Lock written by an incompatible version; upgrade agents-config. |
| `Target '<name>' cannot switch handlers: …` | The old handler still holds cleanup (modified installs or pending `.gitignore` work); resolve the reported paths, enable `manage_gitignore` if asked, and retry. |
