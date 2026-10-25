import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap, type Provider } from "./di/index.ts";
import { configProvider } from "./config.ts";

function buildContainer(env: NodeJS.ProcessEnv, overrides: { configDir?: string; cacheDir?: string }) {
  const overridesProvider: Provider = {
    definitions: {
      ...(overrides.configDir !== undefined ? { "config/dirOverride": () => overrides.configDir } : {}),
      ...(overrides.cacheDir !== undefined ? { "config/cacheDirOverride": () => overrides.cacheDir } : {}),
    },
  };
  return bootstrap(
    new Map<string, Provider>([
      ["platform", { definitions: { "platform/env": () => env } }],
      ["config", configProvider()],
      ["overrides", overridesProvider],
    ])
  );
}

test("config/dirOverride makes config/dir return the override, ignoring XDG_CONFIG_HOME", async () => {
  const overrideDir = await mkdtemp(join(tmpdir(), "agents-config-override-"));
  const unusedXdgParent = await mkdtemp(join(tmpdir(), "agents-config-unused-xdg-"));

  const container = buildContainer({ ...process.env, XDG_CONFIG_HOME: unusedXdgParent }, { configDir: overrideDir });
  assert.equal(await container.resolve<Promise<string>>("config/dir"), overrideDir);
});

test("config/path resolves inside the override directory", async () => {
  const overrideDir = await mkdtemp(join(tmpdir(), "agents-config-override-"));
  const container = buildContainer(process.env, { configDir: overrideDir });
  assert.equal(await container.resolve<Promise<string>>("config/path"), join(overrideDir, "config.yaml"));
});

test("config/loaded reads config.yaml from the override directory", async () => {
  const overrideDir = await mkdtemp(join(tmpdir(), "agents-config-override-"));
  await mkdir(overrideDir, { recursive: true });
  await writeFile(join(overrideDir, "config.yaml"), "targets:\n  claude: true\n");

  const container = buildContainer(process.env, { configDir: overrideDir });
  const config = await container.resolve<Promise<import("./layer.ts").Layer>>("config/loaded");
  assert.deepEqual(config.targets, { claude: true });
});

test("config/cacheDir uses XDG_CACHE_HOME when no cacheDirOverride is set", () => {
  const container = buildContainer({ ...process.env, XDG_CACHE_HOME: "/tmp/fake-cache-home-pre-override" }, {});
  assert.equal(
    container.resolve<string>("config/cacheDir"),
    join("/tmp/fake-cache-home-pre-override", "agents-config", "repos")
  );
});

test("config/cacheDirOverride makes config/cacheDir return the override, ignoring XDG_CACHE_HOME", async () => {
  const overrideDir = await mkdtemp(join(tmpdir(), "agents-config-override-"));
  const cacheOverrideDir = join(overrideDir, "cache-override");
  const container = buildContainer({ ...process.env, XDG_CACHE_HOME: "/tmp/should-be-ignored" }, { cacheDir: cacheOverrideDir });
  assert.equal(container.resolve<string>("config/cacheDir"), cacheOverrideDir);
});
