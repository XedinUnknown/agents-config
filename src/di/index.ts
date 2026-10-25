/**
 * di — barrel
 *
 * Vendored from @uny/di — see types.ts for provenance.
 */

export type {
  Definition,
  Extension,
  Provider,
  KeyProvenance,
  ComposedProvider,
  Container,
} from "./types.ts";

export { composeProviders } from "./compose.ts";

export {
  DelegatingContainer,
  CachingContainer,
  ProxyContainer,
  CompositeContainer,
} from "./containers.ts";

export { CircularDetector } from "./circular.ts";

export { bootstrap } from "./bootstrap.ts";

export { DependencyError, MissingKeyError, CircularDependencyError } from "./errors.ts";

export {
  factory,
  value,
  alias,
  construct,
} from "./definitions.ts";

export type { DependencyAwareDefinition } from "./definitions.ts";
