/**
 * Vendored from @uny/di's own test suite — see types.ts for provenance.
 * Adapted only for import paths (this project has no package subpath
 * exports; everything comes from the local barrel).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  composeProviders,
  DelegatingContainer,
  CachingContainer,
  ProxyContainer,
  CompositeContainer,
  CircularDetector,
  bootstrap,
  type Provider,
  MissingKeyError,
  CircularDependencyError,
  factory,
  value,
  alias,
  construct,
} from "./index.ts";

describe("composition library (di)", () => {
  // ── Override semantics ──────────────────────────────────────────────────

  describe("override semantics", () => {
    it("later provider definition overrides earlier one", () => {
      const A: Provider = { definitions: { key: () => "A" } };
      const B: Provider = { definitions: { key: () => "B" } };
      const providers = new Map<string, Provider>([
        ["A", A],
        ["B", B],
      ]);
      const provider = composeProviders(providers);
      const c = new DelegatingContainer(provider);
      assert.strictEqual(c.resolve("key"), "B");
    });
  });

  // ── Extension semantics ─────────────────────────────────────────────────

  describe("extension semantics", () => {
    it("extensions compose in provider order", () => {
      const A: Provider = { definitions: { list: () => [] } };
      const B: Provider = {
        extensions: {
          list: (prev) => [...(prev ?? []), "a", "b"],
        },
      };
      const C: Provider = {
        extensions: {
          list: (prev) => [...prev, "c"],
        },
      };
      const providers = new Map<string, Provider>([
        ["A", A],
        ["B", B],
        ["C", C],
      ]);
      const provider = composeProviders(providers);
      const c = new DelegatingContainer(provider);
      assert.deepStrictEqual(c.resolve("list"), ["a", "b", "c"]);
    });

    it("extensions receive container for dependency lookup", () => {
      const A: Provider = {
        definitions: {
          base: () => "base",
          enhanced: (c) => `${c.resolve("base")}-enhanced`,
        },
      };
      const B: Provider = {
        extensions: {
          enhanced: (prev, c) => `${prev}+${c.resolve("base")}`,
        },
      };
      const providers = new Map<string, Provider>([
        ["A", A],
        ["B", B],
      ]);
      const provider = composeProviders(providers);
      const c = new DelegatingContainer(provider);
      assert.strictEqual(c.resolve("enhanced"), "base-enhanced+base");
    });
  });

  // ── DelegatingContainer ─────────────────────────────────────────────────

  describe("DelegatingContainer", () => {
    it("resolves from provider definitions", () => {
      const p: Provider = { definitions: { k: () => "v" } };
      const provider = composeProviders(new Map([["p", p]]));
      const c = new DelegatingContainer(provider);
      assert.strictEqual(c.resolve("k"), "v");
    });

    it("delegates to parent when set", () => {
      const parentProvider = composeProviders(
        new Map([["p", { definitions: { fromParent: () => "parent" } }]])
      );
      const parent = new DelegatingContainer(parentProvider);

      const childProvider = composeProviders(
        new Map([
          [
            "p",
            {
              definitions: {
                usesParent: (c) => c.resolve("fromParent"),
              },
            },
          ],
        ])
      );
      const child = new DelegatingContainer(childProvider, parent);

      assert.strictEqual(child.resolve("usesParent"), "parent");
    });

    it("uses self when no parent set", () => {
      const p: Provider = {
        definitions: {
          k: (c) => {
            // Should not throw — resolves from self
            if (c.has("k")) return "self";
            return "no-self";
          },
        },
      };
      const provider = composeProviders(new Map([["p", p]]));
      const c = new DelegatingContainer(provider);
      // has() returns true because 'k' is defined
      assert.strictEqual(c.resolve("k"), "self");
    });

    it("has() returns true for defined keys", () => {
      const p: Provider = { definitions: { k: () => "v" } };
      const provider = composeProviders(new Map([["p", p]]));
      const c = new DelegatingContainer(provider);
      assert.strictEqual(c.has("k"), true);
    });

    it("has() returns false for missing keys", () => {
      const p: Provider = { definitions: { k: () => "v" } };
      const provider = composeProviders(new Map([["p", p]]));
      const c = new DelegatingContainer(provider);
      assert.strictEqual(c.has("missing"), false);
    });

    it("has() returns true for extension-only keys", () => {
      const A: Provider = { definitions: { list: () => [] } };
      const B: Provider = {
        extensions: {
          extra: (prev) => prev ?? "added",
        },
      };
      const provider = composeProviders(
        new Map([
          ["A", A],
          ["B", B],
        ])
      );
      const c = new DelegatingContainer(provider);
      assert.strictEqual(c.has("extra"), true);
    });

    it("keys() returns all defined and extended keys", () => {
      const A: Provider = {
        definitions: { a: () => 1, b: () => 2 },
      };
      const B: Provider = {
        extensions: { c: (prev) => prev ?? 3 },
      };
      const provider = composeProviders(
        new Map([
          ["A", A],
          ["B", B],
        ])
      );
      const c = new DelegatingContainer(provider);
      assert.deepStrictEqual(c.keys(), ["a", "b", "c"]);
    });
  });

  // ── CachingContainer ────────────────────────────────────────────────────

  describe("CachingContainer", () => {
    it("resolving container does not cache", () => {
      let count = 0;
      const p: Provider = { definitions: { k: () => ++count } };
      const providers = new Map<string, Provider>([["p", p]]);
      const provider = composeProviders(providers);
      const c = new DelegatingContainer(provider);
      assert.strictEqual(c.resolve("k"), 1);
      assert.strictEqual(c.resolve("k"), 2);
      assert.strictEqual(count, 2);
    });

    it("caching container wraps and caches another container", () => {
      let count = 0;
      const p: Provider = { definitions: { k: () => ++count } };
      const providers = new Map<string, Provider>([["p", p]]);
      const provider = composeProviders(providers);
      const resolving = new DelegatingContainer(provider);
      const cached = new CachingContainer(resolving);
      assert.strictEqual(cached.resolve("k"), 1);
      assert.strictEqual(cached.resolve("k"), 1);
      assert.strictEqual(count, 1);
    });
  });

  // ── ProxyContainer ──────────────────────────────────────────────────────

  describe("ProxyContainer", () => {
    it("throws before inner is set", () => {
      const proxy = new ProxyContainer();
      assert.throws(() => proxy.resolve("k"), /inner container not set/);
    });

    it("forwards to inner after set", () => {
      const inner = new DelegatingContainer(
        composeProviders(
          new Map([["p", { definitions: { k: () => "inner" } }]])
        )
      );
      const proxy = new ProxyContainer();
      proxy.setInnerContainer(inner);
      assert.strictEqual(proxy.resolve("k"), "inner");
    });

    it("has() throws before inner is set", () => {
      const proxy = new ProxyContainer();
      assert.throws(() => proxy.has("k"), /inner container not set/);
    });

    it("has() forwards after set", () => {
      const inner = new DelegatingContainer(
        composeProviders(
          new Map([["p", { definitions: { k: () => "v" } }]])
        )
      );
      const proxy = new ProxyContainer();
      proxy.setInnerContainer(inner);
      assert.strictEqual(proxy.has("k"), true);
    });
  });

  // ── CompositeContainer ──────────────────────────────────────────────────

  describe("CompositeContainer", () => {
    it("returns first match from multiple containers", () => {
      const c1 = new DelegatingContainer(
        composeProviders(
          new Map([["p1", { definitions: { k: () => "first" } }]])
        )
      );
      const c2 = new DelegatingContainer(
        composeProviders(
          new Map([["p2", { definitions: { k: () => "second" } }]])
        )
      );
      const composite = new CompositeContainer([c1, c2]);
      assert.strictEqual(composite.resolve("k"), "first");
    });

    it("falls through to second container if first doesn't have key", () => {
      const c1 = new DelegatingContainer(
        composeProviders(new Map([["p1", { definitions: {} }]]))
      );
      const c2 = new DelegatingContainer(
        composeProviders(
          new Map([["p2", { definitions: { k: () => "second" } }]])
        )
      );
      const composite = new CompositeContainer([c1, c2]);
      assert.strictEqual(composite.resolve("k"), "second");
    });

    it("throws if no container has the key", () => {
      const c1 = new DelegatingContainer(
        composeProviders(new Map([["p1", { definitions: {} }]]))
      );
      const composite = new CompositeContainer([c1]);
      assert.throws(() => composite.resolve("k"), (err: unknown) => err instanceof MissingKeyError);
    });

    it("has() checks all containers", () => {
      const c1 = new DelegatingContainer(
        composeProviders(new Map([["p1", { definitions: {} }]]))
      );
      const c2 = new DelegatingContainer(
        composeProviders(
          new Map([["p2", { definitions: { k: () => "v" } }]])
        )
      );
      const composite = new CompositeContainer([c1, c2]);
      assert.strictEqual(composite.has("k"), true);
    });

    it("keys() returns union of all containers", () => {
      const c1 = new DelegatingContainer(
        composeProviders(
          new Map([["p1", { definitions: { a: () => 1 } }]])
        )
      );
      const c2 = new DelegatingContainer(
        composeProviders(
          new Map([["p2", { definitions: { b: () => 2 } }]])
        )
      );
      const composite = new CompositeContainer([c1, c2]);
      assert.deepStrictEqual(composite.keys(), ["a", "b"]);
    });
  });

  // ── CircularDetector ────────────────────────────────────────────────────

  describe("CircularDetector", () => {
    /**
     * CircularDetector works as a decorator in the bootstrap chain:
     *   proxy → CircularDetector → DelegatingContainer
     * Factories receive the proxy (via getBaseContainer),
     * which chains through the detector before hitting the delegating container.
     */
    function setupCircularChain(provider: Provider) {
      const composed = composeProviders(new Map([["A", provider]]));
      const proxy = new ProxyContainer();
      const delegating = new DelegatingContainer(composed, proxy);
      const detector = new CircularDetector(delegating);
      proxy.setInnerContainer(detector);
      return detector;
    }

    it("detects circular dependency", () => {
      const A: Provider = {
        definitions: {
          a: (c) => `a:${c.resolve("b")}`,
          b: (c) => `b:${c.resolve("a")}`,
        },
      };
      const c = setupCircularChain(A);
      assert.throws(() => c.resolve("a"), (err: unknown) => err instanceof CircularDependencyError);
    });

    it("allows non-circular chains", () => {
      const A: Provider = {
        definitions: {
          a: (c) => `a:${c.resolve("b")}`,
          b: () => "leaf",
        },
      };
      const c = setupCircularChain(A);
      assert.strictEqual(c.resolve("a"), "a:leaf");
    });

    it("detects longer circular chains", () => {
      const A: Provider = {
        definitions: {
          a: (c) => c.resolve("b"),
          b: (c) => c.resolve("c"),
          c: (c) => c.resolve("a"),
        },
      };
      const c = setupCircularChain(A);
      assert.throws(() => c.resolve("a"), (err: unknown) => err instanceof CircularDependencyError);
    });
  });

  // ── Bootstrap ───────────────────────────────────────────────────────────

  describe("bootstrap", () => {
    it("returns a caching container", () => {
      let count = 0;
      const p: Provider = { definitions: { k: () => ++count } };
      const providers = new Map<string, Provider>([["p", p]]);
      const c = bootstrap(providers);
      assert.strictEqual(c.resolve("k"), 1);
      assert.strictEqual(c.resolve("k"), 1);
      assert.strictEqual(count, 1);
    });

    it("additional containers take priority", () => {
      const p: Provider = {
        definitions: { k: () => "from-provider" },
      };
      const providers = new Map<string, Provider>([["p", p]]);

      const override = new DelegatingContainer(
        composeProviders(
          new Map([
            [
              "override",
              { definitions: { k: () => "from-override" } },
            ],
          ])
        )
      );

      const c = bootstrap(providers, [override]);
      assert.strictEqual(c.resolve("k"), "from-override");
    });

    it("factories see the full app container via proxy", () => {
      const p: Provider = {
        definitions: {
          fromProvider: () => "provider-value",
          usesParent: (c) => c.resolve("fromOverride"),
        },
      };
      const providers = new Map<string, Provider>([["p", p]]);

      const override = new DelegatingContainer(
        composeProviders(
          new Map([
            [
              "override",
              { definitions: { fromOverride: () => "override-value" } },
            ],
          ])
        )
      );

      const c = bootstrap(providers, [override]);
      assert.strictEqual(c.resolve("usesParent"), "override-value");
    });

    it("detects circular dependencies via decorator", () => {
      const p: Provider = {
        definitions: {
          a: (c) => c.resolve("b"),
          b: (c) => c.resolve("a"),
        },
      };
      const providers = new Map<string, Provider>([["p", p]]);
      const c = bootstrap(providers);
      assert.throws(() => c.resolve("a"), (err: unknown) => err instanceof CircularDependencyError);
    });
  });

  // ── Definition helpers ─────────────────────────────────────────────────

  describe("definition helpers", () => {
    describe("factory", () => {
      it("auto-resolves dependencies", () => {
        const p: Provider = {
          definitions: {
            dep: () => 42,
            result: factory(["dep"], (dep: number) => dep * 2),
          },
        };
        const providers = new Map<string, Provider>([["p", p]]);
        const c = bootstrap(providers);
        assert.strictEqual(c.resolve("result"), 84);
      });

      it("exposes dependencies", () => {
        const f = factory(["a", "b"], (a: any, b: any) => a + b);
        assert.deepStrictEqual(f.getDependencies(), ["a", "b"]);
      });

      it("is a Definition — can be used directly", () => {
        const f = factory(["x"], (x: number) => x + 1);
        // f is callable as a Definition
        const c = bootstrap(
          new Map([["p", { definitions: { x: () => 10, y: f } }]])
        );
        assert.strictEqual(c.resolve("y"), 11);
      });
    });

    describe("value", () => {
      it("returns fixed value", () => {
        const p: Provider = {
          definitions: {
            k: value("fixed"),
          },
        };
        const providers = new Map<string, Provider>([["p", p]]);
        const c = bootstrap(providers);
        assert.strictEqual(c.resolve("k"), "fixed");
      });

      it("exposes empty dependencies", () => {
        assert.deepStrictEqual(value(42).getDependencies(), []);
      });

      it("is a Definition", () => {
        const v = value("hello");
        const c = bootstrap(
          new Map([["p", { definitions: { greeting: v } }]])
        );
        assert.strictEqual(c.resolve("greeting"), "hello");
      });
    });

    describe("alias", () => {
      it("resolves from another key", () => {
        const p: Provider = {
          definitions: {
            original: () => "hello",
            ref: alias("original"),
          },
        };
        const providers = new Map<string, Provider>([["p", p]]);
        const c = bootstrap(providers);
        assert.strictEqual(c.resolve("ref"), "hello");
      });

      it("exposes dependency", () => {
        assert.deepStrictEqual(alias("some-key").getDependencies(), ["some-key"]);
      });

      it("is a Definition", () => {
        const a = alias("target");
        const c = bootstrap(
          new Map([
            [
              "p",
              {
                definitions: {
                  target: () => 42,
                  ref: a,
                },
              },
            ],
          ])
        );
        assert.strictEqual(c.resolve("ref"), 42);
      });
    });

    describe("construct", () => {
      it("instantiates class with deps", () => {
        class Service {
          constructor(
            public dep: string,
            public num: number
          ) {}
        }
        const p: Provider = {
          definitions: {
            dep: () => "injected",
            num: () => 123,
            svc: construct(Service, ["dep", "num"]),
          },
        };
        const providers = new Map<string, Provider>([["p", p]]);
        const c = bootstrap(providers);
        const svc = c.resolve<Service>("svc");
        assert.strictEqual(svc.dep, "injected");
        assert.strictEqual(svc.num, 123);
      });

      it("exposes dependencies", () => {
        class Foo {}
        assert.deepStrictEqual(construct(Foo, ["a", "b"]).getDependencies(), [
          "a",
          "b",
        ]);
      });

      it("defaults to empty deps", () => {
        class Bar {}
        assert.deepStrictEqual(construct(Bar).getDependencies(), []);
      });

      it("is a Definition", () => {
        class Num {
          constructor(public n: number) {}
        }
        const c = bootstrap(
          new Map([
            [
              "p",
              {
                definitions: {
                  n: () => 99,
                  inst: construct(Num, ["n"]),
                },
              },
            ],
          ])
        );
        assert.strictEqual(c.resolve<Num>("inst").n, 99);
      });
    });
  });

  // ── Error classes ───────────────────────────────────────────────────────

  describe("error classes", () => {
    it("MissingKeyError includes available keys", () => {
      const p: Provider = { definitions: { k1: () => "v" } };
      const provider = composeProviders(new Map([["p", p]]));
      const c = new DelegatingContainer(provider);
      assert.throws(() => c.resolve("missing"), (err: unknown) => err instanceof MissingKeyError);
      assert.throws(() => c.resolve("missing"), { message: /Key not found: "missing"/ });
      assert.throws(() => c.resolve("missing"), { message: /k1/ });
    });

    it("MissingKeyError shows 'none' when no keys defined", () => {
      const p: Provider = { definitions: {} };
      const provider = composeProviders(new Map([["p", p]]));
      const c = new DelegatingContainer(provider);
      assert.throws(() => c.resolve("missing"), { message: /none/ });
    });
  });

  // ── Provenance ──────────────────────────────────────────────────────

  describe("provenance", () => {
    it("records full override history (definedBy)", () => {
      const A: Provider = { definitions: { key: () => "A" } };
      const B: Provider = { definitions: { key: () => "B" } };
      const C: Provider = { definitions: { key: () => "C" } };
      const providers = new Map<string, Provider>([
        ["A", A],
        ["B", B],
        ["C", C],
      ]);
      const composed = composeProviders(providers);
      const prov = composed.provenance.get("key");
      assert.ok(prov);
      assert.deepStrictEqual(prov.definedBy, ["A", "B", "C"]); // winner is last
      assert.deepStrictEqual(prov.extendedBy, []);
    });

    it("records extension chain (extendedBy) in order", () => {
      const base: Provider = { definitions: { key: () => [] } };
      const ext1: Provider = {
        extensions: { key: (prev) => [...(prev ?? []), "ext1"] },
      };
      const ext2: Provider = {
        extensions: { key: (prev) => [...prev, "ext2"] },
      };
      const providers = new Map<string, Provider>([
        ["base", base],
        ["ext1", ext1],
        ["ext2", ext2],
      ]);
      const composed = composeProviders(providers);
      const prov = composed.provenance.get("key");
      assert.ok(prov);
      assert.deepStrictEqual(prov.definedBy, ["base"]);
      assert.deepStrictEqual(prov.extendedBy, ["ext1", "ext2"]);
    });

    it("app/provenance is resolvable after bootstrap", () => {
      const A: Provider = { definitions: { key: () => "A" } };
      const B: Provider = { definitions: { key: () => "B" } };
      const providers = new Map<string, Provider>([
        ["A", A],
        ["B", B],
      ]);
      const container = bootstrap(providers);
      const prov = container.resolve("app/provenance") as Map<
        string,
        { key: string; definedBy: string[]; extendedBy: string[] }
      >;
      assert.ok(prov instanceof Map);
      const keyProv = prov.get("key");
      assert.ok(keyProv);
      assert.deepStrictEqual(keyProv.definedBy, ["A", "B"]);
    });
  });
});
