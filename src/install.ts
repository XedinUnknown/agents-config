/**
 * The built-in harness handlers — interop, claude, opencode, codex — and the
 * flat copy/link routine they share. Every built-in harness today installs by
 * placing each skill/agent flat into a directory the harness scans. This is
 * the core fix over agentdeps: no _agentdeps_managed/ nesting, so every
 * harness's native flat scanner finds what's installed.
 *
 * Each handler has its own default `paths: { skills, agents }` (relative to
 * the project directory); a target's config overrides either one, and an
 * absent or null value means the default.
 *
 * Each target's record in agents-lock.json lists every concrete path the
 * handler installed for it, so only those are ever updated or removed.
 */
import { mkdir, rm, cp, lstat, symlink, readlink, unlink, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hashPath } from "./hash.ts";
import type { Plan, DesiredItem } from "./plan.ts";
import { ITEM_KINDS, type ItemKind, type SyncReport, type Target, type TargetHandler } from "./registry.ts";
import type { Provider } from "./di/index.ts";

export interface FilesPaths {
  readonly skills: string;
  readonly agents: string;
}

export interface FileInstall {
  kind: ItemKind;
  name: string;
  method: "copy" | "link";
  /** sha256 of the installed copy; empty for links, which always reflect the live source. */
  contentHash: string;
  installedAt: string;
  updatedAt: string;
}

/** A built-in handler's state: its target's record in agents-lock.json. */
export interface FilesState {
  installs?: Record<string, FileInstall>;
}

export interface SyncResult {
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: string[];
  /** Path exists on disk but isn't lock-owned — left alone, not overwritten. */
  skippedForeign: string[];
  /** Lock-owned, no longer desired, but changed on disk since install — left in place and still owned. */
  keptModified: string[];
}

interface Placement {
  kind: ItemKind;
  item: DesiredItem;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Hash of whatever is at `path`, or undefined when it can't be read (missing, dangling link). */
async function hashExisting(path: string): Promise<string | undefined> {
  try {
    return await hashPath(path);
  } catch {
    return undefined;
  }
}

function installedName(item: DesiredItem, sourceIsFile: boolean): string {
  if (!sourceIsFile) return item.name;
  const ext = item.sourcePath.match(/(\.[^./]+)$/)?.[1] ?? "";
  return item.name + ext;
}

async function ensureSymlink(target: string, linkPath: string): Promise<"created" | "replaced" | "unchanged"> {
  let existed = false;
  try {
    const st = await lstat(linkPath);
    existed = true;
    if (st.isSymbolicLink()) {
      if ((await readlink(linkPath)) === target) return "unchanged";
      await unlink(linkPath);
    } else {
      await rm(linkPath, { recursive: true, force: true });
    }
  } catch {
    // Doesn't exist — fall through to create.
  }
  const isTargetFile = await isFile(target);
  await symlink(target, linkPath, isTargetFile ? "file" : "dir");
  return existed ? "replaced" : "created";
}

/** Every concrete path the plan should occupy, keyed relative to the project directory. */
async function placements(paths: FilesPaths, plan: Plan): Promise<Map<string, Placement>> {
  const byPath = new Map<string, Placement>();
  for (const kind of ITEM_KINDS) {
    for (const item of plan[kind]) {
      const name = installedName(item, await isFile(item.sourcePath));
      byPath.set(join(paths[kind], name), { kind, item });
    }
  }
  return byPath;
}

/**
 * Remove a no-longer-desired lock-owned path, unless it changed on disk since
 * it was installed. Returns false when the path was kept.
 */
async function prune(abs: string, entry: FileInstall): Promise<boolean> {
  let st;
  try {
    st = await lstat(abs);
  } catch {
    return true; // Already gone.
  }
  if (entry.method === "link") {
    if (!st.isSymbolicLink()) return false;
    await unlink(abs);
    return true;
  }
  if (st.isSymbolicLink() || (await hashExisting(abs)) !== entry.contentHash) return false;
  await rm(abs, { recursive: true, force: true });
  return true;
}

/**
 * Sync the plan into one skills/agents directory pair, mutating `state` to match
 * what is on disk. The caller saves it — including when this throws partway,
 * so that whatever was already placed stays owned.
 */
export async function syncFiles(
  projectDir: string,
  paths: FilesPaths,
  plan: Plan,
  installMethod: "link" | "copy",
  state: FilesState
): Promise<SyncResult> {
  const result: SyncResult = { added: [], updated: [], removed: [], unchanged: [], skippedForeign: [], keptModified: [] };
  const desired = await placements(paths, plan);
  const installs = (state.installs ??= {});

  for (const [path, entry] of Object.entries(installs)) {
    if (desired.has(path)) continue;
    if (await prune(join(projectDir, path), entry)) {
      delete installs[path];
      result.removed.push(path);
    } else {
      result.keptModified.push(path);
    }
  }

  for (const [path, { kind, item }] of desired) {
    const abs = join(projectDir, path);
    const prior = installs[path];

    if (!prior && (await pathExists(abs))) {
      result.skippedForeign.push(path);
      continue;
    }

    await mkdir(dirname(abs), { recursive: true });
    const now = new Date().toISOString();

    if (installMethod === "link") {
      const outcome = await ensureSymlink(item.sourcePath, abs);
      installs[path] = {
        kind,
        name: item.name,
        method: "link",
        contentHash: "",
        installedAt: prior?.installedAt ?? now,
        updatedAt: outcome === "unchanged" && prior ? prior.updatedAt : now,
      };
      if (outcome === "unchanged" && prior) result.unchanged.push(path);
      else if (prior) result.updated.push(path);
      else result.added.push(path);
      continue;
    }

    const contentHash = await hashPath(item.sourcePath);
    const targetMatchesSource = (await hashExisting(abs)) === contentHash;

    if (prior && prior.method === "copy" && prior.contentHash === contentHash && targetMatchesSource) {
      result.unchanged.push(path);
      continue;
    }

    // Lock-owned content that is missing or locally modified is restored.
    await rm(abs, { recursive: true, force: true });
    await cp(item.sourcePath, abs, { recursive: true });
    installs[path] = {
      kind,
      name: item.name,
      method: "copy",
      contentHash,
      installedAt: prior?.installedAt ?? now,
      updatedAt: now,
    };
    if (prior) result.updated.push(path);
    else result.added.push(path);
  }

  if (Object.keys(installs).length === 0) delete state.installs;
  return result;
}

function resolvePaths(targetName: string, options: Readonly<Record<string, unknown>>, defaults: FilesPaths): FilesPaths {
  const raw = options["paths"];
  if (raw !== undefined && raw !== null && (typeof raw !== "object" || Array.isArray(raw))) {
    throw new Error(`Target '${targetName}': paths must be a map of skills/agents directories.`);
  }
  const paths = (raw ?? {}) as Record<string, unknown>;
  const resolved: Record<string, string> = {};
  for (const kind of ITEM_KINDS) {
    const value = paths[kind] ?? defaults[kind];
    if (typeof value !== "string" || value === "") {
      throw new Error(`Target '${targetName}': paths.${kind} must be a non-empty string.`);
    }
    resolved[kind] = value;
  }
  return resolved as unknown as FilesPaths;
}

/** A handler for a harness that scans flat skills/agents directories. */
export function flatDirectoryHandler(defaults: FilesPaths): TargetHandler {
  return {
    validate(target: Target) {
      resolvePaths(target.name, target.options, defaults);
    },
    async sync(ctx): Promise<SyncReport> {
      const paths = resolvePaths(ctx.targetName, ctx.options, defaults);
      const r = await syncFiles(ctx.projectDir, paths, ctx.plan, ctx.installMethod, ctx.state as FilesState);
      return {
        added: r.added,
        updated: r.updated,
        removed: r.removed,
        unchanged: r.unchanged,
        warnings: [
          ...r.skippedForeign.map((p) => `${p} already exists and isn't tracked by agents-config — left untouched`),
          ...r.keptModified.map((p) => `${p} is no longer desired but was modified since install — left in place`),
        ],
      };
    },
  };
}

/**
 * Evidence for each built-in's defaults:
 *
 * - interop: the default target when no layer declares `targets`. Not tied to
 *   one CLI binary — a neutral drop point for the `.agents/skills` convention,
 *   which OpenCode scans natively (opencode.ai/docs/skills, 2026-10-24). No
 *   harness is confirmed to read `.agents/agents`.
 * - claude: documented Claude Code convention (`.claude/skills`,
 *   `.claude/agents`); confirmed empty-but-present ~/.claude/skills and
 *   ~/.claude/agents on this machine (2026-08-22).
 * - opencode: its own directories, per opencode.ai/docs/skills and
 *   opencode.ai/docs/agents (2026-10-24): skills in `.opencode/skills`, agents
 *   ONLY in `.opencode/agents` (it doesn't read `.agents/agents` or
 *   `.claude/agents`). Its agent file format differs from Claude Code's (no
 *   `name`, `mode`, tool permissions as a map) — agents are copied unchanged,
 *   so an agent written for Claude Code may need converting; that conversion
 *   belongs in this handler.
 * - codex: UNVERIFIED flat-scan behavior. `codex doctor` confirms CODEX_HOME is
 *   ~/.codex, and vendor skills exist in SKILL.md shape under
 *   ~/.codex/skills/.system/<name>/, but Codex also ships a separate
 *   plugin-marketplace system, and whether it scans flat user subdirectories
 *   of ~/.codex/skills is untested. If it needs more, give it its own handler.
 */
export function installProvider(): Provider {
  return {
    definitions: {
      "handler/interop": () => flatDirectoryHandler({ skills: ".agents/skills", agents: ".agents/agents" }),
      "handler/claude": () => flatDirectoryHandler({ skills: ".claude/skills", agents: ".claude/agents" }),
      "handler/opencode": () => flatDirectoryHandler({ skills: ".opencode/skills", agents: ".opencode/agents" }),
      "handler/codex": () => flatDirectoryHandler({ skills: ".codex/skills", agents: ".codex/agents" }),
    },
  };
}
