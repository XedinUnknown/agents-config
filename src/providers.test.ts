/**
 * Smoke tests for the thin providers that just expose an existing function
 * reference under a key (discovery/manifest/lockfile/hash/install) — each
 * factory returns the SAME function object, so a strict-equality check is
 * enough to prove the wiring is correct; the functions' own behavior is
 * already covered by discovery.test.ts/manifest.test.ts/lockfile.test.ts/
 * hash.test.ts/install.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bootstrap, type Provider } from "./di/index.ts";
import { discoverSkills, discoverAgents, filterItems, discoveryProvider } from "./discovery.ts";
import { loadManifest, saveManifestDependencies, manifestExists, manifestProvider } from "./manifest.ts";
import { loadLock, saveLock, lockfileProvider } from "./lockfile.ts";
import { hashPath, hashProvider } from "./hash.ts";
import { installProvider } from "./install.ts";

function containerFor(provider: Provider) {
  return bootstrap(new Map<string, Provider>([["module", provider]]));
}

test("discoveryProvider exposes the exact discoverSkills/discoverAgents/filterItems references", async () => {
  const c = containerFor(discoveryProvider());
  assert.strictEqual(await c.resolve("discovery/skills"), discoverSkills);
  assert.strictEqual(await c.resolve("discovery/agents"), discoverAgents);
  assert.strictEqual(await c.resolve("discovery/filter"), filterItems);
});

test("manifestProvider exposes the exact loadManifest/saveManifestDependencies/manifestExists references", async () => {
  const c = containerFor(manifestProvider());
  assert.strictEqual(await c.resolve("manifest/load"), loadManifest);
  assert.strictEqual(await c.resolve("manifest/save"), saveManifestDependencies);
  assert.strictEqual(await c.resolve("manifest/exists"), manifestExists);
});

test("lockfileProvider exposes the exact loadLock/saveLock references", async () => {
  const c = containerFor(lockfileProvider());
  assert.strictEqual(await c.resolve("lockfile/load"), loadLock);
  assert.strictEqual(await c.resolve("lockfile/save"), saveLock);
});

test("hashProvider exposes the exact hashPath reference", async () => {
  const c = containerFor(hashProvider());
  assert.strictEqual(await c.resolve("hash/hashPath"), hashPath);
});

test("installProvider contributes one handler per built-in harness", async () => {
  const c = containerFor(installProvider());
  for (const name of ["interop", "claude", "opencode", "codex"]) {
    const handler = await c.resolve<{ sync: unknown }>(`handler/${name}`);
    assert.equal(typeof handler.sync, "function", name);
  }
});
