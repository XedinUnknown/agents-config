/**
 * Install plan — the final winner per skill/agent name across all resolved
 * dependencies, in merged dependency order (see layer.ts).
 *
 * When two dependencies provide the same name, the LATER one wins: it
 * replaces the earlier one in the plan, and only the winner is installed,
 * once. This matches the layering model everywhere else — a later
 * declaration (a project's agents.yaml over config.yaml's defaults, or a
 * later entry within one file) overrides an earlier one.
 */
import type { DiscoveredItem } from "./discovery.ts";
import { ITEM_KINDS, type ItemKind } from "./registry.ts";

/** Where an item came from, as recorded in agents-lock.json. */
export type Origin =
  | { repo: string; ref: string }
  | { path: string }
  | { path: string; ref: string; commit: string };

export function originLabel(origin: Origin): string {
  return "repo" in origin ? origin.repo : `path:${origin.path}`;
}

export interface DesiredItem extends DiscoveredItem {
  origin: Origin;
  /** Overrides the run's install method for this item. */
  method?: "copy" | "link";
}

export interface ResolvedDep {
  origin: Origin;
  method?: "copy" | "link";
  skills: DiscoveredItem[];
  agents: DiscoveredItem[];
}

export interface Replacement {
  kind: ItemKind;
  name: string;
  replaced: string;
  by: string;
}

export interface Plan {
  skills: DesiredItem[];
  agents: DesiredItem[];
  /** Earlier providers of a name that a later dependency overrode. */
  replacements: Replacement[];
}

export function buildPlan(resolved: readonly ResolvedDep[]): Plan {
  const plan: Plan = { skills: [], agents: [], replacements: [] };

  for (const kind of ITEM_KINDS) {
    const winners = new Map<string, DesiredItem>();
    for (const dep of resolved) {
      for (const item of dep[kind]) {
        const earlier = winners.get(item.name);
        if (earlier) {
          plan.replacements.push({
            kind,
            name: item.name,
            replaced: originLabel(earlier.origin),
            by: originLabel(dep.origin),
          });
          // Re-insert so the winner's position reflects where it was declared.
          winners.delete(item.name);
        }
        winners.set(item.name, {
          ...item,
          origin: dep.origin,
          ...(dep.method !== undefined ? { method: dep.method } : {}),
        });
      }
    }
    plan[kind] = [...winners.values()];
  }

  return plan;
}
