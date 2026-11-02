/**
 * Project lockfile — `agents-lock.json` next to agents.yaml, the single
 * ownership record that replaces agentdeps' _agentdeps_managed/ nesting.
 *
 * The lock records:
 *
 *  - `skills`/`agents`: the final winner per name after the last-wins plan
 *    (see plan.ts) — where each installed name came from: `{repo, ref, commit}`,
 *    or `{path}` for a live folder.
 *  - `dependencies`: merged declarations and resolved commits, including
 *    non-winning sources. Absent in older ownership-only version-2 locks.
 *  - `targets`: one record per target, naming the handler that installed it
 *    and holding that handler's own state — e.g. the built-in handlers list
 *    every concrete path they placed on disk, and only ever update or remove
 *    those. A target recorded here but disabled or gone from config is still
 *    handed to its recorded handler, with nothing requested, so it can undo
 *    what it installed.
 */
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Origin } from "./plan.ts";
import { parseLayer, type Dependency } from "./layer.ts";
import type { Provider } from "./di/index.ts";

/** Where a winning item came from: a repository pinned to a commit, or a live path. */
export type LockWinner = Origin;

export interface LockTarget {
  handler: string;
  state: Record<string, unknown>;
}

export interface LockFile {
  version: 2;
  dependencies?: Array<{ dependency: Dependency; commit?: string }>;
  skills: Record<string, LockWinner>;
  agents: Record<string, LockWinner>;
  targets: Record<string, LockTarget>;
}

const LOCK_FILENAME = "agents-lock.json";

export function lockPath(projectDir: string): string {
  return join(projectDir, LOCK_FILENAME);
}

export function emptyLock(): LockFile {
  return { version: 2, skills: {}, agents: {}, targets: {} };
}

export async function loadLock(projectDir: string): Promise<LockFile> {
  let content: string;
  try {
    content = await readFile(lockPath(projectDir), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLock();
    throw error;
  }
  const parsed = JSON.parse(content) as Partial<LockFile>;
  if (parsed.version !== 2 || typeof parsed.targets !== "object" || parsed.targets === null) {
    // Refuse rather than start empty: an unreadable lock would turn every
    // previously installed path into foreign content that is never cleaned up.
    throw new Error(`${lockPath(projectDir)}: unsupported lockfile format (expected version 2).`);
  }
  if (parsed.dependencies !== undefined) {
    if (!Array.isArray(parsed.dependencies)) throw new Error(`${lockPath(projectDir)}: invalid locked dependencies.`);
    for (const record of parsed.dependencies) {
      if (typeof record !== "object" || record === null) {
        throw new Error(`${lockPath(projectDir)}: invalid locked dependency.`);
      }
      parseLayer(JSON.stringify({ dependencies: [record.dependency] }), lockPath(projectDir));
      if ("repo" in record.dependency &&
          (typeof record.commit !== "string" || !/^[a-f0-9]{40,64}$/.test(record.commit))) {
        throw new Error(`${lockPath(projectDir)}: invalid locked commit.`);
      }
    }
  }
  return {
    version: 2,
    skills: parsed.skills ?? {},
    agents: parsed.agents ?? {},
    targets: parsed.targets,
    ...(parsed.dependencies !== undefined ? { dependencies: parsed.dependencies } : {}),
  };
}

export async function saveLock(projectDir: string, lock: LockFile): Promise<void> {
  const empty =
    lock.dependencies === undefined &&
    Object.keys(lock.targets).length === 0 &&
    Object.keys(lock.skills).length === 0 &&
    Object.keys(lock.agents).length === 0;
  if (empty) {
    await rm(lockPath(projectDir), { force: true });
    return;
  }
  const content = JSON.stringify(lock, null, 2) + "\n";
  try {
    if (await readFile(lockPath(projectDir), "utf-8") === content) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(lockPath(projectDir), content, "utf-8");
}

/** Provider exposing lockfile I/O as keyed definitions (the function references themselves). */
export function lockfileProvider(): Provider {
  return {
    definitions: {
      "lockfile/load": () => loadLock,
      "lockfile/save": () => saveLock,
    },
  };
}
