/**
 * di — Circular dependency detector
 *
 * Vendored from @uny/di — see types.ts for provenance.
 */

import type { Container } from "./types.ts";
import { CircularDependencyError } from "./errors.ts";

/**
 * Decorator that detects circular dependencies during resolution.
 * Wraps any container — does NOT need to be the DelegatingContainer.
 */
export class CircularDetector implements Container {
  private resolving = new Set<string>();

  constructor(private inner: Container) {}

  resolve<T = any>(key: string): T {
    if (this.resolving.has(key)) {
      throw new CircularDependencyError(key, [...this.resolving]);
    }

    this.resolving.add(key);
    try {
      return this.inner.resolve<T>(key);
    } finally {
      this.resolving.delete(key);
    }
  }

  has(key: string): boolean {
    return this.inner.has(key);
  }

  keys(): string[] {
    return this.inner.keys?.() ?? [];
  }
}
