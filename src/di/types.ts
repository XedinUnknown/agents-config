/**
 * di — Core types
 *
 * Vendored from @uny/di (uny/packages/di, unpublished as of this copy) — the
 * reference implementation of the config-based-modularity pattern (see
 * Dhii/containers' `config-based-modularity` skill). Copied rather than
 * depended on since @uny/di isn't published yet; keep in sync by hand if it
 * changes upstream.
 */

export type Definition<T = any> = (container: Container) => T;

export type Extension<T = any> = (
  previous: T | undefined,
  container: Container,
) => T;

export interface Provider {
  definitions?: Record<string, Definition>;
  extensions?: Record<string, Extension>;
}

/**
 * Provenance for a single key: which providers defined it (in order,
 * last = winner) and which providers contributed extensions (in order).
 */
export interface KeyProvenance {
  key: string;
  definedBy: string[];   // ordered; last entry is the winning definition
  extendedBy: string[];  // ordered; reflects extension composition order
}

/**
 * The result of composing an ordered provider map.
 * Extends Provider so it can be used anywhere a Provider is expected.
 * The provenance map is a byproduct of composition — it records the
 * full override history and extension chain for every key.
 */
export interface ComposedProvider extends Provider {
  provenance: Map<string, KeyProvenance>;
}

export interface Container {
  resolve<T = any>(key: string): T;
  has(key: string): boolean;
  keys?(): string[];
}
