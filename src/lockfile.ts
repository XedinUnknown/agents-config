/**
 * Project lockfile — `agents-lock.json` next to agents.yaml, the single
 * ownership record that replaces agentdeps' _agentdeps_managed/ nesting.
 *
 * The lock records:
 *
 *  - `skills`/`agents`: the final winner per name after the last-wins plan
 *    (see plan.ts) — which repo and ref each installed name came from.
 *  - `targets`: one record per target, naming the handler that installed it
 *    and holding that handler's own state — e.g. the built-in handlers list
 *    every concrete path they placed on disk, and only ever update or remove
 *    those. A target recorded here but disabled or gone from config is still
 *    handed to its recorded handler, with nothing requested, so it can undo
 *    what it installed.
 */
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Provider } from "./di/index.ts";

export interface LockWinner {
  repo: string;
  ref: string;
}

export interface LockTarget {
  handler: string;
  state: Record<string, unknown>;
}

export interface LockFile {
  version: 2;
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
  } catch {
    return emptyLock();
  }
  const parsed = JSON.parse(content) as Partial<LockFile>;
  if (parsed.version !== 2 || typeof parsed.targets !== "object" || parsed.targets === null) {
    // Refuse rather than start empty: an unreadable lock would turn every
    // previously installed path into foreign content that is never cleaned up.
    throw new Error(`${lockPath(projectDir)}: unsupported lockfile format (expected version 2).`);
  }
  return { version: 2, skills: parsed.skills ?? {}, agents: parsed.agents ?? {}, targets: parsed.targets };
}

export async function saveLock(projectDir: string, lock: LockFile): Promise<void> {
  const empty =
    Object.keys(lock.targets).length === 0 &&
    Object.keys(lock.skills).length === 0 &&
    Object.keys(lock.agents).length === 0;
  if (empty) {
    await rm(lockPath(projectDir), { force: true });
    return;
  }
  await writeFile(lockPath(projectDir), JSON.stringify(lock, null, 2) + "\n", "utf-8");
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
