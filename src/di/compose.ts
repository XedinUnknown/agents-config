/**
 * di — Provider composition
 *
 * Vendored from @uny/di — see types.ts for provenance.
 */

import type { ComposedProvider, Definition, Extension, KeyProvenance, Provider } from "./types.ts";

/**
 * Compose an ordered map of providers into a ComposedProvider.
 * Later definitions override earlier ones.
 * Extensions compose in order (each receives the previous value).
 *
 * Returns a ComposedProvider carrying provenance: the full override history
 * (definedBy) and extension chain (extendedBy) for every key.
 */
export function composeProviders(
  providers: Map<string, Provider>,
): ComposedProvider {
  const composedDefs: Record<string, Definition> = {};
  const composedExts: Record<string, Extension> = {};
  const provenance = new Map<string, KeyProvenance>();

  for (const [name, provider] of providers) {
    // Track definitions: build override history (last = winner)
    if (provider.definitions) {
      for (const key of Object.keys(provider.definitions)) {
        // Record this provider in the override history
        if (!provenance.has(key)) {
          provenance.set(key, { key, definedBy: [], extendedBy: [] });
        }
        const entry = provenance.get(key)!;
        entry.definedBy.push(name);
      }
      Object.assign(composedDefs, provider.definitions);
    }

    // Track extensions: build extension chain
    if (provider.extensions) {
      for (const key of Object.keys(provider.extensions)) {
        if (!provenance.has(key)) {
          provenance.set(key, { key, definedBy: [], extendedBy: [] });
        }
        const entry = provenance.get(key)!;
        entry.extendedBy.push(name);

        // Chain extensions in order
        const existingExt = composedExts[key];
        if (existingExt) {
          const prev = existingExt;
          composedExts[key] = (previous, container) => {
            const result = prev(previous, container);
            return provider.extensions![key]!(result, container);
          };
        } else {
          composedExts[key] = provider.extensions[key]!;
        }
      }
    }
  }

  return {
    definitions: composedDefs,
    extensions: composedExts,
    provenance,
  };
}
