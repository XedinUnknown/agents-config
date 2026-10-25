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
 *     - repo: owner/repo
 *       ref: main
 *       skills: "*" | [names] | true | false
 *       agents: "*" | [names] | true | false
 *
 * Merge order is config.yaml -> agents.yaml: scalars replace, maps merge by
 * key (a target definition naming a different handler than the one it
 * overrides starts from fresh settings, since the old handler's settings mean
 * nothing to the new one). Defaults are not part of the merge: each handler
 * applies its own to settings that are absent or null. Dependencies are keyed
 * by normalized repo: a later layer's entry for the same repo replaces the earlier one in place,
 * a new repo appends. If no layer declares `targets` at all, the `interop`
 * target is enabled.
 *
 * The `dependencies` shape is the same as agentdeps' agents.yaml. agentdeps'
 * config.yaml keys `agents`/`custom_agents` are rejected with a migration
 * hint rather than ignored, so a legacy config can never silently fall back
 * to the default target.
 */
import { parse } from "yaml";
import { DEFAULT_TARGET, type Target } from "./registry.ts";

export type Selection = "*" | string[] | false;

export interface Dependency {
  repo: string;
  ref: string;
  skills: Selection;
  agents: Selection;
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
  /** Enabled targets, in definition order. */
  targets: Target[];
  dependencies: Dependency[];
}

/** Dependency identity across layers (and for `add`/`remove`). */
export function dependencyKey(repo: string): string {
  return repo.replace(/\.git$/, "").toLowerCase();
}

function normalizeSelection(raw: unknown, field: string, source: string): Selection {
  if (raw === undefined || raw === "*" || raw === true) return "*";
  if (raw === false) return false;
  if (Array.isArray(raw) && raw.every((name) => typeof name === "string")) return raw;
  throw new Error(`${source}: '${field}' must be "*", true, false, or a list of names.`);
}

function normalizeDependency(raw: unknown, index: number, source: string): Dependency {
  const dep = (raw ?? {}) as Record<string, unknown>;
  if (typeof dep["repo"] !== "string" || dep["repo"] === "") {
    throw new Error(`${source}: dependency at index ${index} is missing required 'repo' field`);
  }
  return {
    repo: dep["repo"],
    ref: typeof dep["ref"] === "string" ? dep["ref"] : "main",
    skills: normalizeSelection(dep["skills"], "skills", source),
    agents: normalizeSelection(dep["agents"], "agents", source),
  };
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
      dependencies.set(dependencyKey(dep.repo), dep);
    }
  }

  if (!targetsDeclared) {
    targets.set(DEFAULT_TARGET, { enabled: true, handler: DEFAULT_TARGET, options: {} });
  }

  return {
    clone_method: cloneMethod,
    install_method: installMethod,
    targets: [...targets]
      .filter(([, state]) => state.enabled)
      .map(([name, state]) => ({ name, handler: state.handler, options: state.options })),
    dependencies: [...dependencies.values()],
  };
}
