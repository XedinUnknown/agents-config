import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap, type Provider } from "./di/index.ts";
import { configProvider } from "./config.ts";
import type { Layer } from "./layer.ts";

// Each test builds its own fresh container — no shared, memoized module-level
// state to worry about (that's exactly the hidden-state anti-pattern this
// containerization replaced), so tests don't need to agree on one shared env
// or execution order the way the pre-refactor version of this file did.
function buildContainer(env: NodeJS.ProcessEnv) {
  return bootstrap(
    new Map<string, Provider>([
      ["platform", { definitions: { "platform/env": () => env } }],
      ["config", configProvider()],
    ])
  );
}

test("config/dir defaults to <parent>/agents-config when neither directory has a config.yaml", async () => {
  const configParent = await mkdtemp(join(tmpdir(), "agents-config-config-"));
  const container = buildContainer({ ...process.env, XDG_CONFIG_HOME: configParent });
  const dir = await container.resolve<Promise<string>>("config/dir");
  assert.equal(dir, join(configParent, "agents-config"));
});

async function writeAndLoad(content: string): Promise<Layer> {
  const configParent = await mkdtemp(join(tmpdir(), "agents-config-config-"));
  const container = buildContainer({ ...process.env, XDG_CONFIG_HOME: configParent });
  const path = await container.resolve<Promise<string>>("config/path");
  await mkdir(join(configParent, "agents-config"), { recursive: true });
  await writeFile(path, content);
  return container.resolve<Promise<Layer>>("config/loaded");
}

test("config/loaded is an empty layer when config.yaml doesn't exist", async () => {
  const configParent = await mkdtemp(join(tmpdir(), "agents-config-config-"));
  const container = buildContainer({ ...process.env, XDG_CONFIG_HOME: configParent });
  assert.deepEqual(await container.resolve<Promise<Layer>>("config/loaded"), {});
});

test("config/loaded parses config.yaml as a settings layer, dependencies included", async () => {
  const layer = await writeAndLoad(
    "clone_method: ssh\ntargets:\n  claude: true\ndependencies:\n  - repo: owner/repo\n"
  );
  assert.deepEqual(layer, {
    clone_method: "ssh",
    targets: { claude: true },
    dependencies: [{ repo: "owner/repo", ref: "main", skills: "*", agents: "*" }],
  });
});

test("config/loaded rejects an invalid clone_method", async () => {
  await assert.rejects(() => writeAndLoad("clone_method: ftp\n"), /invalid clone_method/);
});

test("config/loaded rejects agentdeps' agents/custom_agents keys instead of silently falling back to interop", async () => {
  await assert.rejects(() => writeAndLoad("agents: [agents-root]\n"), /use 'targets'/);
});

test("config/cacheDir uses XDG_CACHE_HOME/agents-config/repos", () => {
  const container = buildContainer({ ...process.env, XDG_CACHE_HOME: "/tmp/fake-cache-home" });
  const cacheDir = container.resolve<string>("config/cacheDir");
  assert.equal(cacheDir, join("/tmp/fake-cache-home", "agents-config", "repos"));
});
