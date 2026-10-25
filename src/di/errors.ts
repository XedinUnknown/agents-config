/**
 * di — Error classes for dependency resolution
 *
 * Vendored from @uny/di — see types.ts for provenance.
 */

export class DependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DependencyError";
  }
}

export class MissingKeyError extends DependencyError {
  readonly key: string;
  readonly available: string[];

  constructor(key: string, available: string[]) {
    const list =
      available.length === 0
        ? "none"
        : available.join(", ");
    super(`Key not found: "${key}" (defined keys: ${list})`);
    this.name = "MissingKeyError";
    this.key = key;
    this.available = available;
  }
}

export class CircularDependencyError extends DependencyError {
  readonly key: string;
  readonly chain: string[];

  constructor(key: string, chain: string[]) {
    const trace = [...chain, key].join(" → ");
    super(`Circular dependency detected: ${trace}`);
    this.name = "CircularDependencyError";
    this.key = key;
    this.chain = chain;
  }
}
