/**
 * Install state — what each target installed on this machine, kept in
 * `<state_dir>/state.json` (default `.agents/agents-config/state.json`).
 *
 * It holds one record per target: the handler that installed it and that
 * handler's own state (the built-in handlers list every concrete path they
 * placed on disk, and only ever update or remove those). A target recorded
 * here but disabled or gone from config is still handed to its recorded
 * handler, with nothing requested, so it can undo what it installed.
 *
 * Which targets run depends on machine config, so this state differs between
 * machines. The state directory holds a `.gitignore` of `*`, keeping it out
 * of Git without any setup.
 */
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Provider } from "./di/index.ts";

export const DEFAULT_STATE_DIR = join(".agents", "agents-config");

export interface InstallTarget {
  handler: string;
  state: Record<string, unknown>;
}

export type InstallTargets = Record<string, InstallTarget>;

export interface InstallState {
  version: 1;
  targets: InstallTargets;
}

const STATE_FILENAME = "state.json";
const IGNORE = "*\n";

export function statePath(projectDir: string, stateDir: string): string {
  return join(resolve(projectDir, stateDir), STATE_FILENAME);
}

/** The state recorded at `stateDir`, or `undefined` when there is none. */
export async function loadState(projectDir: string, stateDir: string): Promise<InstallState | undefined> {
  const path = statePath(projectDir, stateDir);
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const parsed = JSON.parse(content) as Partial<InstallState>;
  if (parsed.version !== 1 || typeof parsed.targets !== "object" || parsed.targets === null) {
    // Refuse rather than start empty: unreadable state would turn every
    // previously installed path into foreign content that is never cleaned up.
    throw new Error(`${path}: unsupported install state format (expected version 1).`);
  }
  return { version: 1, targets: parsed.targets };
}

/** Write the state, or remove it (and the directory, once empty) when no target has any. */
export async function saveState(projectDir: string, stateDir: string, state: InstallState): Promise<void> {
  const dir = resolve(projectDir, stateDir);
  const path = join(dir, STATE_FILENAME);
  if (Object.keys(state.targets).length === 0) {
    await rm(path, { force: true });
    // Only the ignore file this module wrote; an edited one is the user's.
    const ignore = join(dir, ".gitignore");
    if (await readFile(ignore, "utf-8").catch(() => undefined) === IGNORE) await rm(ignore);
    await rmdir(dir).catch(() => undefined);
    return;
  }
  const content = JSON.stringify(state, null, 2) + "\n";
  try {
    if (await readFile(path, "utf-8") === content) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(join(dir, ".gitignore"), IGNORE, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await writeFile(path, content, "utf-8");
}

/** Provider exposing install state I/O as keyed definitions. */
export function stateProvider(): Provider {
  return {
    definitions: {
      "state/load": () => loadState,
      "state/save": () => saveState,
    },
  };
}
