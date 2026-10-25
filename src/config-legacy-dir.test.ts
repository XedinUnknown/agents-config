import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap, type Provider } from "./di/index.ts";
import { configProvider } from "./config.ts";

test("config/dir falls back to the legacy agentdeps directory when only it has a config.yaml", async () => {
  const configParent = await mkdtemp(join(tmpdir(), "agents-config-legacy-"));
  const legacyDir = join(configParent, "agentdeps");
  await mkdir(legacyDir, { recursive: true });
  await writeFile(join(legacyDir, "config.yaml"), "targets:\n  claude: true\n");

  const container = bootstrap(
    new Map<string, Provider>([
      ["platform", { definitions: { "platform/env": () => ({ ...process.env, XDG_CONFIG_HOME: configParent }) } }],
      ["config", configProvider()],
    ])
  );

  assert.equal(await container.resolve<Promise<string>>("config/dir"), legacyDir);
});

test("config/loaded rejects a legacy agentdeps config.yaml with a hint to migrate to targets", async () => {
  const configParent = await mkdtemp(join(tmpdir(), "agents-config-legacy-"));
  const legacyDir = join(configParent, "agentdeps");
  await mkdir(legacyDir, { recursive: true });
  await writeFile(join(legacyDir, "config.yaml"), "clone_method: https\ninstall_method: copy\nagents: [claude]\n");

  const container = bootstrap(
    new Map<string, Provider>([
      ["platform", { definitions: { "platform/env": () => ({ ...process.env, XDG_CONFIG_HOME: configParent }) } }],
      ["config", configProvider()],
    ])
  );

  await assert.rejects(
    () => container.resolve<Promise<unknown>>("config/loaded"),
    new RegExp(`${join(legacyDir, "config.yaml").replace(/[/.]/g, "\\$&")}: 'agents' and 'custom_agents' are no longer supported`)
  );
});
