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
 *
 * It depends only on the merged dependency declarations, so it is the same on
 * every machine and is meant to be committed. What each target installed on
 * this machine is install state, kept separately (see state.ts).
 *
 * Version 2 locks also held that install state under `targets`; loading one
 * returns it as `legacyTargets` so the caller can move it into the state file.
 */
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Origin } from "./plan.ts";
import { parseLayer, type Dependency } from "./layer.ts";
import type { Provider } from "./di/index.ts";
import type { InstallTargets } from "./state.ts";

/** Where a winning item came from: a repository pinned to a commit, or a live path. */
export type LockWinner = Origin;

export interface LockFile {
  version: 3;
  dependencies?: Array<{ dependency: Dependency; commit?: string }>;
  skills: Record<string, LockWinner>;
  agents: Record<string, LockWinner>;
}

/** A loaded lock, plus the install state a version 2 lock still carried. */
export interface LoadedLock {
  lock: LockFile;
  legacyTargets?: InstallTargets;
}

const LOCK_FILENAME = "agents-lock.json";

export function lockPath(projectDir: string): string {
  return join(projectDir, LOCK_FILENAME);
}

export function emptyLock(): LockFile {
  return { version: 3, skills: {}, agents: {} };
}

export async function loadLock(projectDir: string): Promise<LoadedLock> {
  let content: string;
  try {
    content = await readFile(lockPath(projectDir), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { lock: emptyLock() };
    throw error;
  }
  const parsed = JSON.parse(content) as Partial<Omit<LockFile, "version">> & { version?: unknown; targets?: unknown };
  const legacy = parsed.version === 2;
  if ((parsed.version !== 3 && !legacy) ||
      (legacy && (typeof parsed.targets !== "object" || parsed.targets === null))) {
    // Refuse rather than start empty: a version 2 lock's install state would
    // be lost, turning every installed path into foreign content.
    throw new Error(`${lockPath(projectDir)}: unsupported lockfile format (expected version 3).`);
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
  const lock: LockFile = {
    version: 3,
    skills: parsed.skills ?? {},
    agents: parsed.agents ?? {},
    ...(parsed.dependencies !== undefined ? { dependencies: parsed.dependencies } : {}),
  };
  return legacy ? { lock, legacyTargets: parsed.targets as InstallTargets } : { lock };
}

export async function saveLock(projectDir: string, lock: LockFile): Promise<void> {
  const empty =
    lock.dependencies === undefined &&
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
