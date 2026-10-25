/**
 * Targets and their handlers.
 *
 * A target is one harness destination you enable in `targets:` (claude,
 * opencode, or a custom name). Each target is installed by a *handler*: the
 * code that knows what installing means for that harness — which
 * directories, which file format, any registration — and how to undo it.
 * A target uses the handler with its own name unless it names another one
 * with `handler:`; e.g. a custom `agents-root` target can reuse the
 * `interop` handler with different paths.
 *
 * A handler receives the target's settings exactly as merged from config
 * (built-in settings don't exist in config: a setting that is absent or null
 * means "use the handler's own default"), plus the requested skills and
 * agents, and installs them however its harness needs. It records what it
 * did in its target's section of agents-lock.json, so a later run — or a
 * cleanup after the target is disabled, renamed, or removed from config —
 * can update or undo exactly that.
 *
 * Handlers are keyed container definitions (`handler/<name>`), so any module
 * — a Provider composed into bootstrapApp() — can add a handler for a new
 * harness, with its own defaults, or override a built-in one.
 *
 * There is no "global" resolution mode. Every handler works relative to the
 * project directory `install` runs in.
 */
import type { Plan } from "./plan.ts";

export type ItemKind = "skills" | "agents";

export const ITEM_KINDS: readonly ItemKind[] = ["skills", "agents"];

/** Enabled when no layer declares `targets`. */
export const DEFAULT_TARGET = "interop";

/** A merged, enabled target. */
export interface Target {
  readonly name: string;
  /** Handler name; the target's own name unless config says otherwise. */
  readonly handler: string;
  /** The target's settings from config, minus `handler`. Absent/null = handler default. */
  readonly options: Readonly<Record<string, unknown>>;
}

export interface HandlerContext {
  readonly projectDir: string;
  readonly targetName: string;
  /** The target's settings from config. Empty during cleanup of a target no longer in config. */
  readonly options: Readonly<Record<string, unknown>>;
  /**
   * What to have installed after this call. Empty when the target was
   * disabled or removed: the handler then undoes everything it recorded.
   */
  readonly plan: Plan;
  readonly installMethod: "link" | "copy";
  /**
   * This target's record in agents-lock.json, owned and shaped by the
   * handler. Mutate it in place as work is done: it is saved even if sync
   * throws partway, so whatever was already done stays recorded. Leave it
   * empty when nothing remains installed.
   */
  readonly state: Record<string, unknown>;
}

export interface SyncReport {
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: string[];
  warnings: string[];
}

export interface TargetHandler {
  /** Reject a target's settings before anything is fetched or changed. */
  validate?(target: Target): void;
  sync(ctx: HandlerContext): Promise<SyncReport>;
}

export function handlerKey(name: string): string {
  return `handler/${name}`;
}
