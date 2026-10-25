# agents-config

See [README.md](./README.md) for user-facing usage and configuration. This
file covers design rationale, constraints, and current implementation state
for anyone (human or agent) working on the tool itself.

## Purpose

Declarative dependency manager for AI coding agent skills and subagents — a
replacement for the third-party `agentdeps` tool, which has a fundamental
discovery bug (see Constraints).

`agentdeps` installs everything into a private `<skills-dir>/_agentdeps_managed/<name>/`
subfolder so it can safely prune its own writes without touching hand-authored
skills in the same directory. But every harness (Claude Code, OpenCode, ...) only
scans the *immediate* children of its configured skills root for `SKILL.md` — one
level of nesting is enough to make an installed skill invisible. Confirmed
empirically: skills `agentdeps` installed were never visible to Claude Code or
OpenCode, both of which only walk flat directories.

## Approach

**Core fix: flat install + a lockfile, not a nested managed directory.** Items
install directly as top-level children of the real skills/agents directory, so
every harness's native flat scanner finds them. Ownership is tracked in one
project-level `agents-lock.json`, next to `agents.yaml`, which records the
final winner per skill/agent name plus one record per target: the handler
that installed it and that handler's own state (see Target handlers). The
built-in handlers' state lists every concrete path installed (relative to
the project directory). On sync, for the built-in handlers:

- Only lock-recorded paths are candidates for removal or overwrite.
- A path that exists on disk but isn't lock-owned is left untouched, even if
  desired (protects hand-authored skills sharing the directory). Two targets
  whose paths coincide therefore conflict: the second reports the first's
  installs as foreign. Built-in defaults don't overlap.
- A lock-owned path no longer desired but modified on disk since install
  (copy hash mismatch, or a link replaced by a real file) is warned about and
  left in place, still owned. Desired lock-owned copies that are missing or
  modified are restored.
- An unreadable or old-format lockfile aborts rather than starting empty —
  starting empty would turn every previous install into foreign content.
- Change detection for `install_method: copy` uses a real content hash (sha256
  over sorted file paths + contents), not size/mtime heuristics.
- Links whose target is inside the project (the `*-interop` mirrors) are
  relative, so a moved or cloned project keeps working; links into the
  per-machine dependency cache are absolute.

**Settings layers (`src/layer.ts`)**: `config.yaml` (machine defaults) and
`agents.yaml` (project) share one schema — `clone_method`, `install_method`,
`targets`, `dependencies` — merged `config.yaml` → `agents.yaml`. Scalars
replace, maps merge by key. `targets` values: `true` enables a target,
`false` disables an inherited one, a map adds one or overrides an inherited
one's settings (merged by key, so an override can change just one path).
A map may name a `handler`; naming a different handler than the inherited one
starts its settings fresh. There is no default target: `install` errors
until a layer declares `targets` (normally `interop: true` in `config.yaml`;
`~/.agents` then sets `interop: false`), so why something installs is always
visible in config. Targets run in first-appearance order (`config.yaml`'s
first); re-declaring an inherited target changes its settings, not its
position. The merge contains only what config says — handler defaults are not
merged in (see Target handlers). Dependencies are keyed by normalized repo
or path (`dependencyKey`): a later layer's entry for the same one replaces
the earlier one *in place*, distinct ones append.

**Dependencies: `repo` vs `path` (`src/layer.ts`)**: `repo` is a repository
URI or `owner/repo` only — a bare filesystem path is rejected with a hint,
because relative paths there were resolved against the clone cache (and
every project's `repo: .` would have shared one cache entry). `path` is a
folder with the standard `skills/` + `agents/` layout, resolved against the
project: live without `ref` (linked by default, relative), or with `ref`
read via `git archive` of the resolved commit into the cache (`repo/snapshot`,
keyed by repository and commit) and recorded as `{path, ref, commit}`. Like
Composer's path repositories, a live path pins nothing — the project's own
commit pins it, since path sources normally live in the same repo; `ref` is
for pinning anyway. The convention this enables: a project's own skills live
in its `skills/`/`agents/` and come in via `path: .`, so install folders hold
only installed content and are ignored whole. `~/.agents` is the exception
(its `skills/` is both, because Codex/OpenCode read `~/.agents/skills`
natively), so it keeps a manual ignore list.

**Collision rule: last wins (`src/plan.ts`)**: when two dependencies provide
the same skill or agent name, the later one in merged order replaces the
earlier in the plan; only the winner is installed, once, and the replacement
is reported. This matches the layering everywhere else — a later declaration
overrides an earlier one.

**Target handlers (`src/registry.ts`)**: a target is one harness destination;
a *handler* is the code that knows what installing means for a harness —
directories, file format, registration — and how to undo it. A target uses
the handler with its own name (`claude` → `handler/claude`) unless it names
another with `handler:` (e.g. `agents-root` reusing `interop` with its own
paths). The handler receives the requested skills/agents, the target's
settings exactly as merged from config, and the target's lock record, and
installs however its harness needs. Defaults belong to the handler: a setting
that is absent or `null` means "use the handler's default", so `null` in
`agents.yaml` undoes a `config.yaml` override.

- Called once per target. A target recorded in the lock but disabled, gone
  from config, or now using a different handler is handed to the handler that
  installed it with nothing requested, so it undoes its install (cleanups run
  before installs). If that handler is no longer available, the run aborts
  rather than forgetting what was installed.
- `validate(target)` runs for every enabled target before anything is
  fetched or changed.
- Handlers are container definitions (`handler/<name>`), so a module — a
  `Provider` passed to `bootstrapApp({ modules })`, composed after every
  built-in — adds a handler for a new harness, with its own defaults, or
  overrides a built-in one.
- Built-ins (`src/install.ts`): `interop`, `claude`, `opencode`, `codex`, each
  its own handler with its own default paths, sharing one flat copy/link
  routine internally. `opencode` defaults to `.opencode/skills` +
  `.opencode/agents` — OpenCode reads agents only from `.opencode/agents`
  (opencode.ai/docs/agents, 2026-10-24), and its agent format differs from
  Claude Code's; agents are copied unchanged, so format conversion, when
  needed, belongs in that handler.
- `*-interop` built-ins (`claude-interop`, `opencode-interop`,
  `codex-interop`; `interopVariant`) *extend* the plain handler: each resolves
  `handler/<harness>` from the container (which must implement
  `installItems`, a `HarnessHandler`) and only decides which items to hand
  it, so the plain handler's settings, directories and install method apply,
  and a module overriding the plain handler changes the variant too. They
  make a harness see what an
  earlier target put in `.agents/`: kinds the harness reads natively there
  are left alone; for the others, `unsupported: symlink` mirrors every
  `.agents/` entry (installed or hand-written, read from disk at run time —
  hence the ordering) as links, `unsupported: install` installs the requested
  items. Requested items missing from `.agents/` are installed normally.
  Codex agents must be TOML, so `codex-interop` only allows `install`, and
  the `codex` handler itself skips agents (one warning per run; earlier
  copies are pruned) via `flatDirectoryHandler`'s `unsupported` kinds.
  Handlers get `enabled: false` during cleanup.
- Harness discovery (verified 2026-10-25): OpenCode 1.18.18 loads agents
  only from `.opencode/agents` (temp-dir probe with `opencode agent list`;
  the binary contains no `.agents/agents`). Codex 0.149.0 loads skills from
  both `.agents/skills` and `.codex/skills` (probe with
  `codex debug prompt-input`; `.codex/skills` isn't in its docs); its binary
  has `.codex/agents` and no `.agents/agents`, but no probe got Codex to
  offer project custom agents, so whether it loads `.codex/agents` TOML in
  practice is unconfirmed. Claude Code reads only `.claude/` (docs). On this
  machine, global symlinks (`~/.claude/skills`, `~/.claude/agents`,
  `~/.config/opencode/agents` → `~/.agents/...`) make the global interop
  setup reach all three.

Targets are data from the settings layers, not container keys: `di`
provider override replaces a whole definition, which can't express the
`true`/`false` toggles or merge-by-key settings the layered `targets` need.
Handlers *are* container keys, because they're code.

**Application composition (`src/app.ts`)**: every service in the app — not
just harnesses — is a keyed definition in one container, composed once per
CLI invocation by `bootstrapApp()`: `platform` (cwd/env, so nothing reads
`process.cwd()`/`process.env` directly), `config` (dir/path/cacheDir
resolution + `config.yaml` loading), `repo` (`cache.ts`'s git clone/update,
bound to `config/cacheDir`), `discovery`, `manifest`, `lockfile`, `hash`,
`install` (each exposing its module's existing functions as keys — no
behavior change, just a different way to reach them), `run` (the install
orchestration, `run/install`), and `cli` (the five command bodies,
`src/cli.ts`). `index.ts` is now just commander setup: one `bootstrapApp()`
call in `preAction`, and every `.action()` is a one-line
`container.resolve('cli/<name>')(...)`.

Targets are not container keys — they are data produced by the settings
merge (see Settings layers above).

Not every internal call became a container key. Same-layer dependencies
between core modules with exactly one caller and no cross-module/plugin
boundary (`install.ts` importing `hashPath` directly) were left as
plain imports — citing the `config-based-modularity` skill's own "overly
granular definitions" anti-pattern, converting these would add indirection
with no real payoff. The one *actual* coupling bug fixed by this pass:
`cache.ts`'s `ensureRepo` used to import `repoCacheDir` from `config.ts`
directly; it now takes `cacheDir` as an explicit parameter, supplied by the
`repo/ensure` container definition.

There is no "global" install mode. An earlier version had one (a second
manifest file, a `-g`/`--global` add flag, and a project/global template pair
per harness) and it was removed entirely: every destination it could reach was
already reachable by running `install` from within the target directory as
its own project, with a target whose relative paths match — see
`targets.agents-root`'s bare `skills`/`agents`, which is exactly this trick
for `~/.agents`. The dual-template system was pure redundant complexity,
not a real capability; see Progress for how this came about.

**Config resolution**: the `dependencies` shape stays compatible with
`agentdeps`' `agents.yaml`. Tool config directory prefers
`$XDG_CONFIG_HOME/agents-config`, falling back to `$XDG_CONFIG_HOME/agentdeps`
(the original tool's real directory) when the new one has no `config.yaml`.
`config.yaml` is optional (a missing file is an empty layer). `agentdeps`'
`agents`/`custom_agents` keys are rejected with a hint to use `targets`
(user decision: error, not translate or ignore — ignoring would silently fall
back to `interop`), so a legacy config read through the fallback must be
migrated first.

## Constraints

- Built-in target names match each tool's actual CLI binary name (`claude`,
  `opencode`, `codex`), except `interop`, the default target — a neutral, vendor-agnostic
  name for the shared `.agents/skills` + `.agents/agents` convention, not tied
  to one binary.
- Never silently overwrite content the lockfile doesn't own, and never silently
  let two dependencies clobber each other under the same installed name — both
  must surface as visible warnings.
- Manifest (`agents.yaml`) schema must stay a strict superset of `agentdeps`'
  shape — no migration required for existing files.
- Linux/WSL only for now: no macOS/Windows path branching (agentdeps had it;
  deliberately dropped as unneeded complexity for this machine).
- `codex`'s entry is flagged unverified in its own registry comment: Codex CLI is
  a closed-source binary with a separate plugin-marketplace system, and whether
  it actually flat-scans `~/.codex/skills` the way Claude Code/OpenCode do is
  untested. Confirm empirically before relying on it; if it needs more than a
  flat file drop, give it its own handler.

## Features

Commands: `install`, `add <repo>`, `remove <repo>`, `list`, `config`. Global
options: `-c/--config <dir>`, `--cache-dir <dir>`. Run `agents-config --help`
or `agents-config <command> --help` for the authoritative flag/default
reference — don't duplicate that shape here; document CLI usage in the CLI's
own help text, not this file.

Design notes not obvious from `--help` (see `install --help` for the
`interop`-default behavior itself):

- `install` re-running always prunes stale installs, even when a manifest's
  `dependencies` list is now empty (`syncDir` still runs with an empty
  desired-set rather than short-circuiting — an earlier version of `runInstall`
  short-circuited here, which was a bug; see Progress).
- `add` is flag-driven only, by design, not as a scope cut: the manifest
  already says which repo and which skills/agents declaratively, so there's
  nothing left for an interactive picker to resolve.
- `-c/--config` and `--cache-dir` are general-purpose location overrides —
  they let the caller point the tool at a specific config or cache directory
  instead of the `$XDG_CONFIG_HOME`/`$XDG_CACHE_HOME`-based resolution.
  (Also what makes exercising the tool against fixture data possible without
  touching the user's real config/manifest/cache, but that's a consequence of
  the general mechanism, not its reason for existing.) `agents-config config`
  prints both resolved paths (config file, repo cache) for the current
  invocation — the fastest way to confirm an override actually took effect.
- There is no "global" install mode (see Approach and Progress) — everything
  installs relative to the current directory, full stop.
- `install` requires an `agents.yaml` in the current directory, even when all
  dependencies come from `config.yaml` — the project directory is where the
  lock lives, and running in an arbitrary directory must not install there.
- `add`/`remove` only edit `agents.yaml`'s `dependencies`, preserving its other
  keys and comments. `remove` of a repo declared only in `config.yaml` errors
  and says so.

## Progress

- [x] Real `config-based-modularity` refactor of the harness registry, after
      an initial claim that the codebase already followed that pattern was
      false (there was no DI container anywhere; the registry was a bare
      `Map` with a hand-rolled override function). Rather than hand-roll a
      container primitive here, `src/di/` vendors `@uny/di` — a complete,
      already-built, unpublished (v0.0.0) implementation from `UN1Q-com/uny`,
      the project the `config-based-modularity` skill's own patterns come
      from: keyed `Definition`/`Extension`/`Provider`, `composeProviders` with
      full provenance tracking (`definedBy`/`extendedBy` per key),
      `Delegating`/`Caching`/`Proxy`/`Composite` containers, `CircularDetector`,
      `bootstrap()`, and `factory`/`value`/`alias`/`construct` definition
      helpers — plus its ~40-test suite, copied over unchanged except import
      paths. `src/registry.ts` now composes built-in harnesses and
      `custom_agents` as two `Provider`s into a container per invocation
      (`createHarnessContainer`), replacing the old module-global `Map` +
      `mergeCustomHarnesses`/`resetRegistry`. Verified byte-identical install
      behavior afterward, including against the real `agents-root` config
      shape (legacy `global_skills`/`global_agents` fields included).
- [x] Extended containerization from harnesses to every service in the app,
      per explicit instruction ("I want all app's services to live in the
      container") superseding the earlier harness-only increment above. New:
      `src/app.ts` (`bootstrapApp()`, the single composition entry point),
      `src/cli.ts` (the five CLI command bodies as keyed definitions, moved
      out of `index.ts`). `config.ts`'s `cachedConfigDir`/`configDirOverride`/
      `repoCacheDirOverride` module-level globals and their setter functions
      (`setConfigDirOverride`/`setRepoCacheDirOverride`) are gone entirely —
      folded into `config/dir`/`config/cacheDir`/`config/dirOverride`/
      `config/cacheDirOverride` container keys, with CLI-flag overrides
      composed as a provider rather than mutated via setters.
      `cache.ts`'s `ensureRepo` no longer imports `config.ts` (see Approach) —
      the one real module-to-module coupling this pass fixed.
      `run.ts`'s `runInstall` signature changed (`cwd`/`env`/services are now
      explicit parameters, not read from `process`/imports directly); its
      test fixtures now go through `bootstrapApp()` end to end instead of
      constructing a `ToolConfig` by hand, which is a strictly more faithful
      test of the real CLI path. 126 tests pass (81 top-level + subtests),
      typecheck clean, verified again against the real `agents-root` config
      shape (legacy `global_skills`/`global_agents` fields included) via a
      scratch isolated install/config/list run.
      Replacing `config.yaml` with a JS/TS config file (so a user's own
      modules — e.g. custom target handlers — can be loaded by the CLI) is
      still planned but not yet done; today only `bootstrapApp({ modules })`
      callers can supply modules.
- [x] Manifest, tool config, repo cache (clone/update), discovery, registry,
      lockfile, sync engine, CLI commands — all implemented and typechecked.
- [x] `interop` added as the default harness target (`.agents/` relative to
      cwd) so a bare `install` does something useful without the user having
      to name a specific vendor's harness up front.
- [x] Verified end-to-end in a sandboxed `HOME`/`XDG_CONFIG_HOME`/`XDG_CACHE_HOME`:
      flat install (fixes the discovery bug), idempotent re-run, foreign-file
      protection, prune-on-manifest-change, name-collision guard, legacy
      `agentdeps` config-dir fallback.
- [x] Test suite (`npm test`, Node's built-in `node:test` via `tsx --test`)
      covers hash/manifest/discovery/lockfile/install/registry/config/cache
      units plus two end-to-end `runInstall` tests against a local (no-network)
      git fixture. Writing it surfaced and fixed six real bugs: `ensureSymlink`
      never returned `"replaced"` (a changed link target was misreported as
      newly `added`); `installScope` short-circuited on an empty
      `dependencies` list, skipping the sync call entirely, so removing the
      last dependency from `agents.yaml` never pruned what had been installed;
      and `syncDir` unconditionally `mkdir`'d its target directory even when
      nothing was desired, leaving an empty directory behind for a dependency
      with e.g. `agents: false` (surfaced by the real-config isolated run
      below, on `~/.agents`'s dependencies, which all set `agents: false`). The
      readiness pass also fixed cache keys for refs containing `/`, prevented a
      failed dependency fetch from turning into destructive pruning, and made
      copy installs restore lock-owned content that is missing or locally
      modified.
- [x] Exercised the real CLI (not just internal function calls) end-to-end via
      the new `--config <dir>` flag, in full isolation: a scratch config dir
      mirroring the real `~/.config/agentdeps/config.yaml` (same `agents-root`
      custom harness), a scratch project dir with the real
      `~/.agents/agents.yaml` dependency list (anthropics/skills,
      vercel-labs/agent-browser, Dhii/containers, pardeike/GABS — real network
      clones), and a scratch `XDG_CACHE_HOME`. Verified: correct
      `skills: <name>` install layout under bare `skills/` (matching
      `agents-root`'s non-nested convention), idempotent second run, `list`
      and `config` output, and confirmed afterward that no real
      `~/.cache/agents-config`, `~/.config/agents-config`, or `~/.agents` file
      was touched. Scratch fixture was deleted after (not real state, safe to
      clean up — unlike the `_agentdeps_managed/` directory below).
- [x] Removed the "global" install mode entirely (manifest scope, `-g`/`--global`
      on `add`, `globalManifestPath()`, `HarnessContext.scope`, the
      project/global template pair on `HarnessPaths`/`CustomHarnessDef`).
      Prompted by direct user pushback after this file's own `install --help`
      text described it as a feature ("there's no `-g`!! ... how many times do
      I have to say there's no global mode"). Tracing it through confirmed the
      user was substantively right, not just uninterested: every destination
      the old global/project template pair could reach was already reachable
      by running `install` from within that directory as its own project — the
      dual-template system added a config dimension (and a whole second
      manifest file) for zero actual capability. `CustomHarnessDef` keeps its
      `project_skills`/`project_agents` field names for `agentdeps` compat
      (only the now-meaningless `global_skills`/`global_agents` were dropped
      from the type) — see the compat note in README.md for why an existing
      config doesn't need those two fields removed.
- [x] Layered settings + `targets` + last-wins + central lock: `config.yaml`
      and `agents.yaml` share one schema (`src/layer.ts`), `targets` replaces
      `agents`/`custom_agents`, same-name collisions resolve last-wins
      (`src/plan.ts`, reversing the earlier first-wins rule), and one
      project-level `agents-lock.json` keyed by installed path replaces the
      per-directory locks (`src/lockfile.ts`). Each harness has its own
      handler (`handler/<name>` container key) with its own defaults, which
      modules can add or override via `bootstrapApp({ modules })`; each
      target's lock record names its handler (see Approach). Per-directory v1 locks from earlier dev runs are not
      migrated; their items show up as foreign. Verified with typecheck,
      `npm test` (141 tests, incl. a module-supplied handler end to end, target
      rename and handler switch cleanup), and a sandboxed real-CLI run with local
      fixtures (layered deps, collision, target disable cleanup, `remove`,
      legacy-key abort). Known gap: pruning leaves now-empty target
      directories (e.g. `.claude/skills`) behind.
- [x] No default target, config-order runs, `*-interop` handlers extending
      their plain handler, relative in-project links. Live-tested
      2026-10-25 with the real machine config (`interop`, `claude-interop`,
      `codex-interop`), a real dependency (`anthropics/skills`) and a local
      probe repo in a scratch project: expected layout, idempotent re-run,
      Codex lists the probe skill from `.agents/skills`, Claude Code
      (`claude -p`) sees both the probe skill and agent through the links,
      and disabling `claude-interop` removes only its links.
- [ ] Not yet wired into `~/.agents`'s *real* `agents.yaml` / `config.yaml`
      (only isolated copies were run; the real `config.yaml` still uses
      `agents`/`custom_agents` and must be migrated to `targets` first), and the old
      `~/.agents/skills/_agentdeps_managed/` directory has NOT been touched.
      Do not clean it up until a real (non-sandboxed) install run against the
      actual `~/.agents` is confirmed working.
- [ ] `codex` harness entry unverified (see Constraints).
- [ ] Roadmap: keep installed content out of a project's git automatically —
      e.g. maintain a marked block in the project's `.gitignore` listing the
      paths agents-config installed (copies in `.agents/`, links in
      `.claude/`, `agents-root`'s flat `skills/<name>`), derived from the
      lock. Until then, projects list them by hand (`~/.agents/.gitignore`
      does).
- [ ] Roadmap: convert Markdown agents to Codex's TOML format in the `codex`
      handler (it skips agents with a warning until then).
- No interactive `add` picker — not planned. The manifest already declares
  repo + skill/agent selection declaratively; a picker would just re-prompt
  for information the config already has.

## Validating changes

`npm run typecheck` (strict TS, `noUncheckedIndexedAccess` +
`exactOptionalPropertyTypes`) and `npm test` (Node's built-in test runner via
`tsx --test`). The test suite covers the sandboxed-verification scenarios
above with local fixtures (temp dirs, a local git repo as a fake dependency —
no network access needed). Still verify manually against a sandboxed
`HOME`/`XDG_CONFIG_HOME`/`XDG_CACHE_HOME` before running against a real
config, since `install` mutates real skill/agent directories and the test
suite doesn't cover every harness/config combination.

## Branches

- `master` is the latest stable state, per this machine's project convention.
