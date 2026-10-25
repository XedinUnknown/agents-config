/**
 * Tool config (config.yaml) — the machine-defaults settings layer. Same
 * schema as agents.yaml (see layer.ts); agents.yaml is merged on top of it.
 * Optional: a missing config.yaml is an empty layer.
 *
 * Lives at $XDG_CONFIG_HOME/agents-config (default ~/.config/agents-config).
 * Falls back to the original agentdeps' real directory ($XDG_CONFIG_HOME/agentdeps)
 * when the new one doesn't exist yet. agentdeps' `agents`/`custom_agents` keys
 * are rejected by parseLayer with a hint to use `targets`.
 *
 * Resolution (dir/path/cacheDir/loaded config) is exposed as keyed container
 * definitions (`configProvider()`, below) instead of memoized module-level
 * globals with setter functions — the earlier version of this file had exactly
 * the "hidden dependencies... singleton state" anti-pattern the whole
 * containerization effort is meant to fix.
 */
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseLayer, type Layer } from "./layer.ts";
import type { Container, Provider } from "./di/index.ts";

const DIR_NAME = "agents-config";
const LEGACY_DIR_NAME = "agentdeps";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function configParent(env: NodeJS.ProcessEnv): string {
  const xdg = env["XDG_CONFIG_HOME"];
  return xdg ?? join(homedir(), ".config");
}

async function resolveConfigDir(env: NodeJS.ProcessEnv, override: string | undefined): Promise<string> {
  if (override) return override;

  const parent = configParent(env);
  const preferred = join(parent, DIR_NAME);
  const legacy = join(parent, LEGACY_DIR_NAME);

  if (await exists(join(preferred, "config.yaml"))) return preferred;
  if (await exists(join(legacy, "config.yaml"))) return legacy;
  return preferred;
}

/**
 * Cloned dependency repos are cache data (regenerable via a re-clone, not
 * user-authored state), so per the XDG Base Directory spec they belong under
 * XDG_CACHE_HOME, not XDG_CONFIG_HOME — a distinct env var from the one
 * config/dir reads, each with its own fallback (~/.cache vs ~/.config).
 */
function resolveCacheDir(env: NodeJS.ProcessEnv, override: string | undefined): string {
  if (override) return override;
  const xdg = env["XDG_CACHE_HOME"];
  return join(xdg ?? join(homedir(), ".cache"), DIR_NAME, "repos");
}

/**
 * Provider contributing config resolution as keyed definitions:
 *
 *  - config/dirOverride, config/cacheDirOverride: override slots, undefined
 *    by default. The CLI's `-c/--config`/`--cache-dir` flags set these by
 *    composing a second provider after this one (see app.ts's
 *    `overridesProvider`) rather than mutable setter functions — later
 *    provider wins, per `di`'s own override semantics.
 *  - config/dir, config/path, config/cacheDir: the override -> XDG ->
 *    legacy-agentdeps-fallback resolution, unchanged logic, now lazy
 *    container factories instead of memoized module-level globals.
 *  - config/loaded: config.yaml parsed and validated as a settings Layer,
 *    or an empty layer when the file doesn't exist.
 */
export function configProvider(): Provider {
  return {
    definitions: {
      "config/dirOverride": () => undefined as string | undefined,
      "config/cacheDirOverride": () => undefined as string | undefined,
      "config/dir": async (c: Container) => {
        const env = c.resolve<NodeJS.ProcessEnv>("platform/env");
        const override = c.resolve<string | undefined>("config/dirOverride");
        return resolveConfigDir(env, override);
      },
      "config/path": async (c: Container) => {
        const dir = await c.resolve<Promise<string>>("config/dir");
        return join(dir, "config.yaml");
      },
      "config/cacheDir": (c: Container) => {
        const env = c.resolve<NodeJS.ProcessEnv>("platform/env");
        const override = c.resolve<string | undefined>("config/cacheDirOverride");
        return resolveCacheDir(env, override);
      },
      "config/loaded": async (c: Container): Promise<Layer> => {
        const path = await c.resolve<Promise<string>>("config/path");
        if (!(await exists(path))) return {};
        return parseLayer(await readFile(path, "utf-8"), path);
      },
    },
  };
}
