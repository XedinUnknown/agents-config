/**
 * Install orchestration: config.yaml + agents.yaml layers -> merged settings
 * -> resolved deps -> last-wins plan -> each target's handler installs it,
 * resolutions pinned by the project's agents-lock.json, and what each target
 * installed on this machine tracked in its install state (state.ts).
 *
 * Every dependency is fetched and every configuration error raised (unknown
 * handler, settings a handler rejects, a lock record whose handler is no
 * longer available to undo it) before anything on disk changes: a failed fetch must
 * never look like a removed dependency and prune what it previously installed.
 */
import { join, resolve } from "node:path";
import { stat } from "node:fs/promises";
import { resolveRepoUrl, deriveCacheKey, type EnsureRepoFn, type SnapshotRepoFn } from "./cache.ts";
import { dependencyLabel, isPathDependency, mergeLayers, type Dependency, type Layer, type Selection } from "./layer.ts";
import type { DiscoveredItem } from "./discovery.ts";
import { buildPlan, type Origin, type Plan, type ResolvedDep } from "./plan.ts";
import type { LoadedLock, LockFile } from "./lockfile.ts";
import { DEFAULT_STATE_DIR, statePath, type InstallState } from "./state.ts";
import { ITEM_KINDS, handlerKey, type SyncReport, type Target, type TargetHandler } from "./registry.ts";
import type { Container, Provider } from "./di/index.ts";

type FilterItemsFn = (
  discovered: readonly DiscoveredItem[],
  selection: Selection
) => { selected: DiscoveredItem[]; missing: string[] };

/** Everything `runInstall` needs from outside itself, resolved once by `run/install`'s factory. */
export interface RunServices {
  ensureRepo: EnsureRepoFn;
  snapshotRepo: SnapshotRepoFn;
  isDirectory: (path: string) => Promise<boolean>;
  discoverSkills: (repoPath: string) => Promise<DiscoveredItem[]>;
  discoverAgents: (repoPath: string) => Promise<DiscoveredItem[]>;
  filterItems: FilterItemsFn;
  manifestExists: (path: string) => Promise<boolean>;
  loadManifest: (path: string) => Promise<Layer>;
  loadLock: (projectDir: string) => Promise<LoadedLock>;
  saveLock: (projectDir: string, lock: LockFile) => Promise<void>;
  loadState: (projectDir: string, stateDir: string) => Promise<InstallState | undefined>;
  saveState: (projectDir: string, stateDir: string, state: InstallState) => Promise<void>;
  getHandler: (name: string) => TargetHandler | undefined;
}

/** Where a dependency's files are on disk, and what to record about where they came from. */
async function fetchDep(
  dep: Dependency,
  cwd: string,
  cloneMethod: "ssh" | "https",
  services: RunServices,
  commit?: string
): Promise<{ dir: string; origin: Origin; method?: "copy" | "link" }> {
  const label = dependencyLabel(dep);
  const override = dep.install_method !== undefined ? { method: dep.install_method } : {};

  if (!isPathDependency(dep)) {
    const url = resolveRepoUrl(dep.repo, cloneMethod);
    const ref = commit ?? dep.ref;
    console.log(`  fetching ${label} (${ref})`);
    const cached = await services.ensureRepo(url, ref, deriveCacheKey(dep.repo, ref));
    if (!cached.success) throw new Error(`Failed to cache ${label}: ${cached.error ?? "unknown error"}`);
    const snapshot = await services.snapshotRepo(cached.path, commit ?? "HEAD");
    if (!snapshot.success) throw new Error(`Failed to snapshot ${label}: ${snapshot.error ?? "unknown error"}`);
    return { dir: snapshot.path, origin: { repo: dep.repo, ref: dep.ref, commit: snapshot.commit }, ...override };
  }

  const folder = resolve(cwd, dep.path);
  if (!(await services.isDirectory(folder))) throw new Error(`${label}: ${folder} is not a directory`);
  // A live folder is linked by default, so edits show up immediately.
  return { dir: folder, origin: { path: dep.path }, method: dep.install_method ?? "link" };
}

async function resolveDeps(
  deps: readonly Dependency[],
  cwd: string,
  cloneMethod: "ssh" | "https",
  services: RunServices,
  locked?: LockFile["dependencies"]
): Promise<ResolvedDep[]> {
  const resolved: ResolvedDep[] = [];

  for (const [index, dep] of deps.entries()) {
    const label = dependencyLabel(dep);
    const { dir, origin, method } = await fetchDep(dep, cwd, cloneMethod, services, locked?.[index]?.commit);

    const [discoveredSkills, discoveredAgents] = await Promise.all([
      services.discoverSkills(dir),
      services.discoverAgents(dir),
    ]);

    const skillResult = services.filterItems(discoveredSkills, dep.skills);
    const agentResult = services.filterItems(discoveredAgents, dep.agents);

    if (dep.skills !== false && discoveredSkills.length === 0) {
      console.warn(`  ⚠ no skills found in ${label} (no skills/ directory or no SKILL.md files)`);
    }
    if (skillResult.missing.length > 0) {
      console.warn(`  ⚠ skills not found in ${label}: ${skillResult.missing.join(", ")}`);
    }
    if (dep.agents !== false && discoveredAgents.length === 0) {
      console.warn(`  ⚠ no agents found in ${label} (no agents/ directory)`);
    }
    if (agentResult.missing.length > 0) {
      console.warn(`  ⚠ agents not found in ${label}: ${agentResult.missing.join(", ")}`);
    }

    resolved.push({
      origin,
      ...(method !== undefined ? { method } : {}),
      skills: skillResult.selected,
      agents: agentResult.selected,
    });
  }

  return resolved;
}

function reportSync(target: string, report: SyncReport): void {
  const lines: Array<[string, string[]]> = [
    ["added", report.added],
    ["updated", report.updated],
    ["removed", report.removed],
  ];
  for (const [verb, items] of lines) {
    if (items.length > 0) console.log(`    [${target}] ${verb} ${items.length} item${items.length === 1 ? "" : "s"}`);
  }
  for (const warning of report.warnings) {
    console.warn(`    ⚠ [${target}] ${warning}`);
  }
}

interface TargetRun {
  name: string;
  handlerName: string;
  handler: TargetHandler;
  options: Readonly<Record<string, unknown>>;
}

const NOTHING: Plan = { skills: [], agents: [], replacements: [] };

/**
 * Resolve every handler this run needs, before anything is fetched or changed:
 * one install run per enabled target, plus a cleanup run for every target the
 * install state records that is now disabled, gone from config, or using a different
 * handler — handled by the handler that installed it.
 */
function planRuns(targets: readonly Target[], state: InstallState, statePath: string, services: RunServices) {
  const installs: TargetRun[] = [];
  for (const target of targets) {
    const handler = services.getHandler(target.handler);
    if (!handler) {
      throw new Error(
        target.handler === target.name
          ? `Unknown target '${target.name}': there is no '${target.name}' handler (set 'handler:' to use another one).`
          : `Target '${target.name}': there is no '${target.handler}' handler.`
      );
    }
    handler.validate?.(target);
    installs.push({ name: target.name, handlerName: target.handler, handler, options: target.options });
  }

  const cleanups: TargetRun[] = [];
  for (const [name, record] of Object.entries(state.targets)) {
    if (installs.some((run) => run.name === name && run.handlerName === record.handler)) continue;
    const handler = services.getHandler(record.handler);
    if (!handler) {
      throw new Error(
        `Target '${name}' was installed by the '${record.handler}' handler, which is no longer available` +
          ` — it is needed to undo that install (see ${statePath}).`
      );
    }
    cleanups.push({ name, handlerName: record.handler, handler, options: {} });
  }

  return { installs, cleanups };
}

/**
 * This machine's install state. A version 2 lock's `targets` seed it when no
 * state file exists yet; an existing state file wins, since a committed lock
 * may carry another machine's state.
 */
async function loadInstallState(
  cwd: string,
  stateDir: string,
  legacyTargets: InstallState["targets"] | undefined,
  services: RunServices
): Promise<InstallState> {
  const state = await services.loadState(cwd, stateDir);
  if (state) return state;
  if (legacyTargets !== undefined) {
    console.log(`  moving install state from agents-lock.json to ${statePath(cwd, stateDir)}`);
    return { version: 1, targets: legacyTargets };
  }
  if (stateDir !== DEFAULT_STATE_DIR && (await services.loadState(cwd, DEFAULT_STATE_DIR))) {
    console.warn(
      `  ⚠ install state exists at ${statePath(cwd, DEFAULT_STATE_DIR)}, but state_dir is ${stateDir}; ` +
        "items installed before are treated as foreign until that state is moved there."
    );
  }
  return { version: 1, targets: {} };
}

/**
 * The actual orchestration, taking the machine layer, cwd, and services as
 * explicit parameters rather than importing/reading them itself — this is
 * `run/install`'s factory body (below), split out so it can be exercised
 * directly (e.g. in tests) without a full container.
 */
export async function runInstall(machine: Layer, cwd: string, services: RunServices, update = false): Promise<void> {
  const manifestPath = join(cwd, "agents.yaml");
  if (!(await services.manifestExists(manifestPath))) {
    console.log("No agents.yaml found in the current directory.");
    return;
  }

  const settings = mergeLayers([machine, await services.loadManifest(manifestPath)]);
  if (!settings.targetsDeclared) {
    throw new Error(
      "No targets declared in config.yaml or agents.yaml. Declare where to install, e.g. in config.yaml:\n" +
        "  targets:\n" +
        "    interop: true"
    );
  }
  const { lock, legacyTargets } = await services.loadLock(cwd);
  const state = await loadInstallState(cwd, settings.state_dir, legacyTargets, services);
  const runs = planRuns(settings.targets, state, statePath(cwd, settings.state_dir), services);
  const lockExists = await services.manifestExists(join(cwd, "agents-lock.json"));
  if (!update && lockExists) {
    if (lock.dependencies === undefined) {
      throw new Error("This lockfile has no pinned dependency resolutions. Run agents-config update.");
    }
    if (JSON.stringify(lock.dependencies.map((record) => record.dependency)) !== JSON.stringify(settings.dependencies)) {
      throw new Error("Dependencies differ from agents-lock.json. Run agents-config update.");
    }
  }

  if (settings.dependencies.length === 0) {
    console.log("No dependencies defined.");
  }
  console.log(`  targets: ${settings.targets.map((t) => t.name).join(", ") || "(none)"}`);

  // Still run the (possibly empty) sync below even with no dependencies: a
  // manifest that just had its last dependency removed must prune whatever
  // was previously installed, not leave it stranded.
  const resolved = await resolveDeps(settings.dependencies, cwd, settings.clone_method, services,
    update ? undefined : lock.dependencies);
  lock.dependencies = settings.dependencies.map((dependency, index) => {
    const origin = resolved[index]!.origin;
    return { dependency, ...("commit" in origin && origin.commit !== undefined ? { commit: origin.commit } : {}) };
  });
  const plan = buildPlan(resolved);
  for (const r of plan.replacements) {
    console.log(`    ${r.kind}/${r.name}: ${r.by} replaces ${r.replaced} (later dependency wins)`);
  }

  for (const kind of ITEM_KINDS) {
    lock[kind] = Object.fromEntries(plan[kind].map((item) => [item.name, item.origin]));
  }
  // Resolution is durable even if a later handler fails; install state is
  // saved below as handlers make progress.
  await services.saveLock(cwd, lock);
  // A version 2 lock's install state now lives in the state file.
  if (legacyTargets !== undefined) await services.saveState(cwd, settings.state_dir, state);

  const sync = async (run: TargetRun, enabled: boolean): Promise<SyncReport> => {
    const record = state.targets[run.name] ?? { handler: run.handlerName, state: {} };
    state.targets[run.name] = record;
    try {
      const report = await run.handler.sync({
        projectDir: cwd,
        targetName: run.name,
        enabled,
        options: run.options,
        plan: enabled ? plan : NOTHING,
        installMethod: settings.install_method,
        manageGitignore: settings.manage_gitignore,
        state: record.state,
      });
      reportSync(run.name, report);
      return report;
    } finally {
      if (Object.keys(record.state).length === 0) delete state.targets[run.name];
    }
  };

  const cleanupSync = async (run: TargetRun): Promise<SyncReport> => {
    const record = state.targets[run.name]!;
    const report = await run.handler.sync({
      projectDir: cwd,
      targetName: run.name,
      enabled: false,
      options: run.options,
      plan: NOTHING,
      installMethod: settings.install_method,
      manageGitignore: settings.manage_gitignore,
      state: record.state,
    });
    reportSync(run.name, report);
    return report;
  };

  try {
    for (const run of runs.cleanups) {
      const report = await cleanupSync(run);
      const left = state.targets[run.name];
      if (left && !report.cleanupBlocked && Object.keys(left.state).length === 0) delete state.targets[run.name];
      const remaining = state.targets[run.name];
      if (remaining && runs.installs.some((i) => i.name === run.name)) {
        if (report.cleanupBlocked) {
          throw new Error(`Target '${run.name}' cannot switch handlers: ${report.cleanupBlocked}`);
        }
        throw new Error(`Target '${run.name}' cannot switch handlers: the '${remaining.handler}' handler retained state after cleanup`);
      }
    }
    for (const run of runs.installs) {
      await sync(run, true);
    }
  } finally {
    await services.saveState(cwd, settings.state_dir, state);
  }

  console.log("\nInstall complete");
}

/**
 * Provider for `run/install`: a zero-arg callable that resolves everything
 * `runInstall` needs from the container it closes over (config, platform
 * values, repo/discovery/manifest/lockfile services, and `handler/<name>`
 * definitions — which any composed module may add or override).
 */
export function runProvider(): Provider {
  return {
    definitions: {
      "run/update": (c: Container) => async (): Promise<void> => {
        await c.resolve<(update?: boolean) => Promise<void>>("run/install")(true);
      },
      "run/install": (c: Container) => async (update = false): Promise<void> => {
        const machine = await c.resolve<Promise<Layer>>("config/loaded");
        const cwd = c.resolve<string>("platform/cwd");

        const services: RunServices = {
          ensureRepo: c.resolve<EnsureRepoFn>("repo/ensure"),
          snapshotRepo: c.resolve<SnapshotRepoFn>("repo/snapshot"),
          isDirectory: async (path) => {
            try {
              return (await stat(path)).isDirectory();
            } catch {
              return false;
            }
          },
          discoverSkills: c.resolve("discovery/skills"),
          discoverAgents: c.resolve("discovery/agents"),
          filterItems: c.resolve("discovery/filter"),
          manifestExists: c.resolve("manifest/exists"),
          loadManifest: c.resolve("manifest/load"),
          loadLock: c.resolve("lockfile/load"),
          saveLock: c.resolve("lockfile/save"),
          loadState: c.resolve("state/load"),
          saveState: c.resolve("state/save"),
          getHandler: (name) => (c.has(handlerKey(name)) ? c.resolve<TargetHandler>(handlerKey(name)) : undefined),
        };

        await runInstall(machine, cwd, services, update);
      },
    },
  };
}
