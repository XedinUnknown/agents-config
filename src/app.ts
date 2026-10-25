/**
 * Application bootstrap — composes every module's `Provider` into one
 * container, per config-based-modularity's Bootstrap Pattern:
 *
 *  1. platform (cwd/env) — host-adapted process state, so nothing below
 *     reads process.cwd()/process.env directly.
 *  2. config — override slots + XDG/legacy-fallback resolution + config.yaml
 *     loading (the machine settings layer; see layer.ts).
 *  3. repo, discovery, manifest, lockfile, hash, install — the app's
 *     remaining services, each exposed as a keyed definition.
 *  4. run — the install orchestration, resolving config/repo/discovery/
 *     manifest/lockfile/install at call time. Targets are not container
 *     keys: they are data merged from the settings layers (built-in ->
 *     config.yaml -> agents.yaml), with toggle and merge-by-key semantics
 *     that provider override (later definition replaces earlier) doesn't
 *     express.
 *  5. cli — the five command bodies, resolving whatever they need from
 *     everything above.
 *  6. modules — caller-supplied providers, composed after every built-in so
 *     they can add services or override any of them; in particular a module
 *     adds a target handler by defining `handler/<name>` (see registry.ts).
 *  7. overrides — the CLI's `-c/--config`/`--cache-dir` flag values,
 *     composed *last* so they win over config's own default (undefined)
 *     definitions for the same two keys, per `di`'s override semantics
 *     (later provider wins).
 *
 * This order is the single, documented composition order the whole app has
 * (Design Checklist: "load order is deterministic and visible").
 */
import { bootstrap, type Container, type Provider } from "./di/index.ts";
import { configProvider } from "./config.ts";
import { repoProvider } from "./cache.ts";
import { discoveryProvider } from "./discovery.ts";
import { manifestProvider } from "./manifest.ts";
import { lockfileProvider } from "./lockfile.ts";
import { hashProvider } from "./hash.ts";
import { installProvider } from "./install.ts";
import { runProvider } from "./run.ts";
import { cliProvider } from "./cli.ts";

export interface BootstrapOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly configDirOverride?: string;
  readonly cacheDirOverride?: string;
  /** Extra modules, by name, composed after the built-ins in iteration order. */
  readonly modules?: ReadonlyMap<string, Provider>;
}

function platformProvider(opts: BootstrapOptions): Provider {
  return {
    definitions: {
      "platform/cwd": () => opts.cwd,
      "platform/env": () => opts.env,
    },
  };
}

/** Host-supplied overrides (CLI flags), composed last so they win per key. */
function overridesProvider(opts: BootstrapOptions): Provider {
  const definitions: Record<string, () => string | undefined> = {};
  if (opts.configDirOverride !== undefined) {
    definitions["config/dirOverride"] = () => opts.configDirOverride;
  }
  if (opts.cacheDirOverride !== undefined) {
    definitions["config/cacheDirOverride"] = () => opts.cacheDirOverride;
  }
  return { definitions };
}

export function bootstrapApp(opts: BootstrapOptions): Container {
  const providers = new Map<string, Provider>([
    ["platform", platformProvider(opts)],
    ["config", configProvider()],
    ["repo", repoProvider()],
    ["discovery", discoveryProvider()],
    ["manifest", manifestProvider()],
    ["lockfile", lockfileProvider()],
    ["hash", hashProvider()],
    ["install", installProvider()],
    ["run", runProvider()],
    ["cli", cliProvider()],
  ]);
  for (const [name, module] of opts.modules ?? []) {
    // A same-named entry would silently replace a built-in provider in place.
    if (providers.has(name)) throw new Error(`Module name '${name}' is reserved for a built-in provider.`);
    providers.set(name, module);
  }
  providers.set("overrides", overridesProvider(opts));
  return bootstrap(providers);
}
