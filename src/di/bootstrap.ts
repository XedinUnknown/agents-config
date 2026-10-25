/**
 * di — Bootstrap
 *
 * Vendored from @uny/di — see types.ts for provenance.
 */

import type { Container, Provider } from "./types.ts";
import { composeProviders } from "./compose.ts";
import {
  DelegatingContainer,
  CachingContainer,
  ProxyContainer,
  CompositeContainer,
} from "./containers.ts";
import { CircularDetector } from "./circular.ts";

/**
 * Bootstrap wiring. Takes an ordered map of providers and returns a cached
 * container with full delegation support.
 *
 * Composition happens internally. Provenance (override history + extension
 * chain for every key) is stored under the `app/provenance` key in the
 * composed definitions, making it resolvable via the container.
 *
 * Bootstrap wiring (matches Dhii pattern):
 *   providers → composeProviders
 *   → inject app/provenance definition
 *   → DelegatingContainer(composed, proxy)    — resolves from provider, delegates to proxy
 *   → CircularDetector(delegating)            — detects cycles (decorator)
 *   → CompositeContainer([extras, detected])  — external containers take priority
 *   → CachingContainer(composite)             — caches resolved values
 *   → proxy.setInnerContainer(caching)        — closes the loop
 */
export function bootstrap(
  providers: Map<string, Provider>,
  additionalContainers: Container[] = []
): Container {
  const composed = composeProviders(providers);

  // Store provenance under app/provenance so it's resolvable via the container
  if (!composed.definitions) {
    composed.definitions = {};
  }
  composed.definitions['app/provenance'] = () => composed.provenance;

  const proxy = new ProxyContainer();
  const delegating = new DelegatingContainer(composed, proxy);
  const detected = new CircularDetector(delegating);
  const appContainer = new CachingContainer(
    new CompositeContainer([...additionalContainers, detected])
  );
  proxy.setInnerContainer(appContainer);
  return appContainer;
}
