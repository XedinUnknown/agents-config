/**
 * Settings layers — the one schema shared by config.yaml (machine defaults)
 * and agents.yaml (the project layer):
 *
 *   clone_method: https | ssh
 *   install_method: copy | link
 *   targets:
 *     claude: true                 # enable a built-in (or inherited) target
 *     interop: false               # disable an inherited target
 *     agents-root:                 # add a target, or override an inherited one's settings
 *       handler: interop           # optional; defaults to the handler named like the target
 *       paths: { skills: skills, agents: agents }   # absent/null = the handler's default
 *   dependencies:
 *     - repo: owner/repo           # or https://, git@host:, file:// URI
 *       ref: main
 *       skills: "*" | [names] | true | false
 *       agents: "*" | [names] | true | false
 *     - path: .                    # a folder with skills/ + agents/, relative to
 *       ref: v1.2                  # the project; optional ref pins it to a revision
 *       install_method: copy       # optional per-dependency override
 *
 * Merge order is config.yaml -> agents.yaml: scalars replace, maps merge by
 * key (a target definition naming a different handler than the one it
 * overrides starts from fresh settings, since the old handler's settings mean
 * nothing to the new one). Defaults are not part of the merge: each handler
 * applies its own to settings that are absent or null. Dependencies are keyed
 * by normalized repo or path: a later layer's entry for the same repo replaces the earlier one in place,
 * a new repo appends. There is no default target: if no layer declares
 * `targets`, install stops with an error (declare `interop: true` in
 * config.yaml for the usual default).
 *
 * Targets run in the order they first appear: config.yaml's in written
 * order, then targets new in agents.yaml. Re-declaring an inherited target
 * changes its settings, not its position. Order matters for `*-interop`
 * targets, which read what an earlier target put in `.agents/`.
 *
 * The `dependencies` shape is the same as agentdeps' agents.yaml. agentdeps'
 * config.yaml keys `agents`/`custom_agents` are rejected with a migration
 * hint rather than ignored, so a legacy config can never silently fall back
 * to the default target.
 */
import { normalize } from "node:path";
import { parse } from "yaml";
import type { Target } from "./registry.ts";

export type Selection = "*" | string[] | false;

interface DependencyBase {
  skills: Selection;
  agents: Selection;
  /** Overrides the run's install method for this dependency's items. */
  install_method?: "link" | "copy";
}

/** A git repository, by URI (`https://`, `git@host:`, `file://`, ...) or `owner/repo` GitHub shorthand. */
export interface RepoDependency extends DependencyBase {
  repo: string;
  ref: string;
}

/**
 * A folder with the standard `skills/` + `agents/` layout, relative to the
 * project directory (or absolute). Without `ref` it is read live from disk
 * and linked by default; with `ref` it is read from git at that revision,
 * which pins it.
 */
export interface PathDependency extends DependencyBase {
  path: string;
  ref?: string;
}

export type Dependency = RepoDependency | PathDependency;

export function isPathDependency(dep: Dependency): dep is PathDependency {
  return "path" in dep;
}

/** A target definition in one layer: an optional handler name plus that handler's options. */
export type TargetOverride = Record<string, unknown>;

/** One parsed, validated, not-yet-merged settings file. Absent keys inherit. */
export interface Layer {
  clone_method?: "ssh" | "https";
  install_method?: "link" | "copy";
  targets?: Record<string, boolean | TargetOverride>;
  dependencies?: Dependency[];
}

export interface Settings {
  clone_method: "ssh" | "https";
  install_method: "link" | "copy";
  /** Whether any layer has a `targets` key; install refuses to guess when none does. */
  targetsDeclared: boolean;
  /** Enabled targets, in the order they first appear across layers — the order they run in. */
  targets: Target[];
  dependencies: Dependency[];
}

export function repoKey(repo: string): string {
  return `repo:${repo.replace(/\.git$/, "").toLowerCase()}`;
}

export function pathKey(path: string): string {
  const normalized = normalize(path).replace(/\/+$/, "");
  return `path:${normalized === "" ? "." : normalized}`;
}

/** Dependency identity across layers (and for `remove`). */
export function dependencyKey(dep: Dependency): string {
  return isPathDependency(dep) ? pathKey(dep.path) : repoKey(dep.repo);
}

/** How a dependency is shown in output: its repo, or `path:<path>`. */
export function dependencyLabel(dep: Dependency): string {
  return isPathDependency(dep) ? `path:${dep.path}` : dep.repo;
}

/**
 * Whether `repo` is a repository URI or `owner/repo` shorthand — not a bare
 * filesystem path, which belongs in `path:` (or `file://` for a repository).
 */
export function isRepoUri(repo: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(repo)) return true; // https://, ssh://, file://
  if (/^[^@/\s]+@[^:/\s]+:/.test(repo)) return true; // git@host:owner/repo
  return /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/.test(repo); // owner/repo
}

function normalizeSelection(raw: unknown, field: string, source: string): Selection {
  if (raw === undefined || raw === "*" || raw === true) return "*";
  if (raw === false) return false;
  if (Array.isArray(raw) && raw.every((name) => typeof name === "string")) return raw;
  throw new Error(`${source}: '${field}' must be "*", true, false, or a list of names.`);
}

function normalizeDependency(raw: unknown, index: number, source: string): Dependency {
  const dep = (raw ?? {}) as Record<string, unknown>;
  const where = `${source}: dependency at index ${index}`;
  const hasRepo = dep["repo"] !== undefined;
  const hasPath = dep["path"] !== undefined;
  if (hasRepo === hasPath) {
    throw new Error(`${where} needs exactly one of 'repo' or 'path'`);
  }
  if (dep["ref"] !== undefined && (typeof dep["ref"] !== "string" || dep["ref"] === "")) {
    throw new Error(`${where}: 'ref' must be a non-empty string`);
  }
  const installMethod = dep["install_method"];
  if (installMethod !== undefined && installMethod !== "link" && installMethod !== "copy") {
    throw new Error(`${where}: install_method must be "link" or "copy"`);
  }
  const base: DependencyBase = {
    skills: normalizeSelection(dep["skills"], "skills", source),
    agents: normalizeSelection(dep["agents"], "agents", source),
    ...(installMethod !== undefined ? { install_method: installMethod } : {}),
  };

  if (hasPath) {
    if (typeof dep["path"] !== "string" || dep["path"] === "") {
      throw new Error(`${where}: 'path' must be a non-empty string`);
    }
    return { path: dep["path"], ...(dep["ref"] !== undefined ? { ref: dep["ref"] as string } : {}), ...base };
  }

  const repo = dep["repo"];
  if (typeof repo !== "string" || repo === "") {
    throw new Error(`${where}: 'repo' must be a non-empty string`);
  }
  if (!isRepoUri(repo)) {
    throw new Error(
      `${where}: '${repo}' is not a repository URI or owner/repo. ` +
        "Use 'path:' for a folder, or a file:// URI for a local repository."
    );
  }
  return { repo, ref: (dep["ref"] as string | undefined) ?? "main", ...base };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTargets(raw: unknown, source: string): Record<string, boolean | TargetOverride> {
  if (!isPlainObject(raw)) {
    throw new Error(`${source}: 'targets' must be a map of target name to true, false, or a definition.`);
  }
  const targets: Record<string, boolean | TargetOverride> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "boolean") {
      targets[name] = value;
      continue;
    }
    if (!isPlainObject(value)) {
      throw new Error(`${source}: target '${name}' must be true, false, or a definition map.`);
    }
    if ("handler" in value && (typeof value["handler"] !== "string" || value["handler"] === "")) {
      throw new Error(`${source}: target '${name}' handler must be a non-empty string.`);
    }
    targets[name] = value;
  }
  return targets;
}

/** Parse one settings file's content. `source` names the file in error messages. */
export function parseLayer(content: string, source: string): Layer {
  const raw = (parse(content) ?? {}) as Record<string, unknown>;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${source}: expected a YAML map at the top level.`);
  }

  if ("agents" in raw || "custom_agents" in raw) {
    throw new Error(
      `${source}: 'agents' and 'custom_agents' are no longer supported; use 'targets' instead, e.g.\n` +
        "  targets:\n" +
        "    claude: true\n" +
        "    my-target:\n" +
        "      paths: { skills: skills, agents: agents }"
    );
  }

  const layer: Layer = {};

  const cloneMethod = raw["clone_method"];
  if (cloneMethod !== undefined) {
    if (cloneMethod !== "ssh" && cloneMethod !== "https") {
      throw new Error(`${source}: invalid clone_method "${String(cloneMethod)}". Must be "ssh" or "https".`);
    }
    layer.clone_method = cloneMethod;
  }

  const installMethod = raw["install_method"];
  if (installMethod !== undefined) {
    if (installMethod !== "link" && installMethod !== "copy") {
      throw new Error(`${source}: invalid install_method "${String(installMethod)}". Must be "link" or "copy".`);
    }
    layer.install_method = installMethod;
  }

  if (raw["targets"] !== undefined) {
    layer.targets = parseTargets(raw["targets"], source);
  }

  const deps = raw["dependencies"];
  if (deps !== undefined && deps !== null) {
    if (!Array.isArray(deps)) {
      throw new Error(`${source}: 'dependencies' must be an array.`);
    }
    layer.dependencies = deps.map((dep, i) => normalizeDependency(dep, i, source));
  }

  return layer;
}

interface TargetState {
  enabled: boolean;
  handler: string;
  options: Record<string, unknown>;
}

/** Merge maps by key, recursively; anything else (scalars, lists, null) replaces. */
function mergeOptions(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const prior = merged[key];
    merged[key] = isPlainObject(prior) && isPlainObject(value) ? mergeOptions(prior, value) : value;
  }
  return merged;
}

/**
 * Merge layers, lowest precedence first. Target settings contain only what
 * config says — defaults belong to each handler, which applies them to
 * settings that are absent or null. Whether a target's handler exists and
 * accepts its settings is checked in run.ts, before anything is fetched.
 */
export function mergeLayers(layers: readonly Layer[]): Settings {
  const targets = new Map<string, TargetState>();
  let cloneMethod: Settings["clone_method"] = "https";
  let installMethod: Settings["install_method"] = "copy";
  let targetsDeclared = false;
  const dependencies = new Map<string, Dependency>();

  for (const layer of layers) {
    if (layer.clone_method !== undefined) cloneMethod = layer.clone_method;
    if (layer.install_method !== undefined) installMethod = layer.install_method;

    if (layer.targets !== undefined) {
      targetsDeclared = true;
      for (const [name, value] of Object.entries(layer.targets)) {
        const state = targets.get(name) ?? { enabled: false, handler: name, options: {} };
        if (typeof value === "boolean") {
          state.enabled = value;
        } else {
          const { handler, ...options } = value;
          if (typeof handler === "string" && handler !== state.handler) {
            // The previous handler's settings mean nothing to a different one.
            state.handler = handler;
            state.options = {};
          }
          state.enabled = true;
          state.options = mergeOptions(state.options, options);
        }
        targets.set(name, state);
      }
    }

    for (const dep of layer.dependencies ?? []) {
      dependencies.set(dependencyKey(dep), dep);
    }
  }

  return {
    clone_method: cloneMethod,
    install_method: installMethod,
    targetsDeclared,
    targets: [...targets]
      .filter(([, state]) => state.enabled)
      .map(([name, state]) => ({ name, handler: state.handler, options: state.options })),
    dependencies: [...dependencies.values()],
  };
}
