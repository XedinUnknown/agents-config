/**
 * Install orchestration: config.yaml + agents.yaml layers -> merged settings
 * -> resolved deps -> last-wins plan -> each target's handler installs it,
 * tracked by the project's agents-lock.json.
 *
 * Every dependency is fetched and every configuration error raised (unknown
 * handler, settings a handler rejects, a lock record whose handler is no
 * longer available to undo it) before anything on disk changes: a failed fetch must
 * never look like a removed dependency and prune what it previously installed.
 */
import { join, resolve } from "node:path";
import { stat } from "node:fs/promises";
import { resolveRepoUrl, deriveCacheKey, type EnsureRepoFn, type SnapshotPathFn } from "./cache.ts";
import { dependencyLabel, isPathDependency, mergeLayers, type Dependency, type Layer, type Selection } from "./layer.ts";
import type { DiscoveredItem } from "./discovery.ts";
import { buildPlan, type Origin, type Plan, type ResolvedDep } from "./plan.ts";
import type { LockFile } from "./lockfile.ts";
import { ITEM_KINDS, handlerKey, type SyncReport, type Target, type TargetHandler } from "./registry.ts";
import type { Container, Provider } from "./di/index.ts";

type FilterItemsFn = (
  discovered: readonly DiscoveredItem[],
  selection: Selection
) => { selected: DiscoveredItem[]; missing: string[] };

/** Everything `runInstall` needs from outside itself, resolved once by `run/install`'s factory. */
export interface RunServices {
  ensureRepo: EnsureRepoFn;
  snapshotPath: SnapshotPathFn;
  isDirectory: (path: string) => Promise<boolean>;
  discoverSkills: (repoPath: string) => Promise<DiscoveredItem[]>;
  discoverAgents: (repoPath: string) => Promise<DiscoveredItem[]>;
  filterItems: FilterItemsFn;
  manifestExists: (path: string) => Promise<boolean>;
  loadManifest: (path: string) => Promise<Layer>;
  loadLock: (projectDir: string) => Promise<LockFile>;
  saveLock: (projectDir: string, lock: LockFile) => Promise<void>;
  getHandler: (name: string) => TargetHandler | undefined;
}

/** Where a dependency's files are on disk, and what to record about where they came from. */
async function fetchDep(
  dep: Dependency,
  cwd: string,
  cloneMethod: "ssh" | "https",
  services: RunServices
): Promise<{ dir: string; origin: Origin; method?: "copy" | "link" }> {
  const label = dependencyLabel(dep);
  const override = dep.install_method !== undefined ? { method: dep.install_method } : {};

  if (!isPathDependency(dep)) {
    const url = resolveRepoUrl(dep.repo, cloneMethod);
    console.log(`  fetching ${label} (${dep.ref})`);
    const cached = await services.ensureRepo(url, dep.ref, deriveCacheKey(dep.repo, dep.ref));
    if (!cached.success) throw new Error(`Failed to cache ${label}: ${cached.error ?? "unknown error"}`);
    return { dir: cached.path, origin: { repo: dep.repo, ref: dep.ref }, ...override };
  }

  const folder = resolve(cwd, dep.path);
  if (dep.ref === undefined) {
    if (!(await services.isDirectory(folder))) throw new Error(`${label}: ${folder} is not a directory`);
    // A live folder is linked by default, so edits show up immediately.
    return { dir: folder, origin: { path: dep.path }, method: dep.install_method ?? "link" };
  }

  console.log(`  reading ${label} at ${dep.ref}`);
  const snapshot = await services.snapshotPath(folder, dep.ref);
  if (!snapshot.success) throw new Error(`Failed to read ${label} at ${dep.ref}: ${snapshot.error ?? "unknown error"}`);
  return { dir: snapshot.path, origin: { path: dep.path, ref: dep.ref, commit: snapshot.commit }, ...override };
}

async function resolveDeps(
  deps: readonly Dependency[],
  cwd: string,
  cloneMethod: "ssh" | "https",
  services: RunServices
): Promise<ResolvedDep[]> {
  const resolved: ResolvedDep[] = [];

  for (const dep of deps) {
    const label = dependencyLabel(dep);
    const { dir, origin, method } = await fetchDep(dep, cwd, cloneMethod, services);

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
    for (const item of items) console.log(`    [${target}] ${verb} ${item}`);
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
 * lock records that is now disabled, gone from config, or using a different
 * handler — handled by the handler that installed it.
 */
function planRuns(targets: readonly Target[], lock: LockFile, services: RunServices) {
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
  for (const [name, record] of Object.entries(lock.targets)) {
    if (installs.some((run) => run.name === name && run.handlerName === record.handler)) continue;
    const handler = services.getHandler(record.handler);
    if (!handler) {
      throw new Error(
        `Target '${name}' was installed by the '${record.handler}' handler, which is no longer available` +
          " — it is needed to undo that install (see agents-lock.json)."
      );
    }
    cleanups.push({ name, handlerName: record.handler, handler, options: {} });
  }

  return { installs, cleanups };
}

/**
 * The actual orchestration, taking the machine layer, cwd, and services as
 * explicit parameters rather than importing/reading them itself — this is
 * `run/install`'s factory body (below), split out so it can be exercised
 * directly (e.g. in tests) without a full container.
 */
export async function runInstall(machine: Layer, cwd: string, services: RunServices): Promise<void> {
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
  const lock = await services.loadLock(cwd);
  const runs = planRuns(settings.targets, lock, services);

  if (settings.dependencies.length === 0) {
    console.log("No dependencies defined.");
  }
  console.log(`  targets: ${settings.targets.map((t) => t.name).join(", ") || "(none)"}`);

  // Still run the (possibly empty) sync below even with no dependencies: a
  // manifest that just had its last dependency removed must prune whatever
  // was previously installed, not leave it stranded.
  const resolved = await resolveDeps(settings.dependencies, cwd, settings.clone_method, services);
  const plan = buildPlan(resolved);
  for (const r of plan.replacements) {
    console.log(`    ${r.kind}/${r.name}: ${r.by} replaces ${r.replaced} (later dependency wins)`);
  }

  for (const kind of ITEM_KINDS) {
    lock[kind] = Object.fromEntries(plan[kind].map((item) => [item.name, item.origin]));
  }

  const sync = async (run: TargetRun, enabled: boolean): Promise<void> => {
    const record = lock.targets[run.name] ?? { handler: run.handlerName, state: {} };
    lock.targets[run.name] = record;
    try {
      const report = await run.handler.sync({
        projectDir: cwd,
        targetName: run.name,
        enabled,
        options: run.options,
        plan: enabled ? plan : NOTHING,
        installMethod: settings.install_method,
        state: record.state,
      });
      reportSync(run.name, report);
    } finally {
      if (Object.keys(record.state).length === 0) delete lock.targets[run.name];
    }
  };

  try {
    for (const run of runs.cleanups) {
      await sync(run, false);
      const left = lock.targets[run.name];
      if (left && runs.installs.some((i) => i.name === run.name)) {
        // The target switched handlers; the new one starts its own record.
        console.warn(`    ⚠ [${run.name}] what the '${left.handler}' handler left in place is no longer tracked`);
        delete lock.targets[run.name];
      }
    }
    for (const run of runs.installs) {
      await sync(run, true);
    }
  } finally {
    await services.saveLock(cwd, lock);
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
      "run/install": (c: Container) => async (): Promise<void> => {
        const machine = await c.resolve<Promise<Layer>>("config/loaded");
        const cwd = c.resolve<string>("platform/cwd");

        const services: RunServices = {
          ensureRepo: c.resolve<EnsureRepoFn>("repo/ensure"),
          snapshotPath: c.resolve<SnapshotPathFn>("repo/snapshot"),
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
          getHandler: (name) => (c.has(handlerKey(name)) ? c.resolve<TargetHandler>(handlerKey(name)) : undefined),
        };

        await runInstall(machine, cwd, services);
      },
    },
  };
}
