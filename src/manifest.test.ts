import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadManifest, saveManifestDependencies, manifestExists } from "./manifest.ts";
import type { Dependency } from "./layer.ts";

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "agents-config-manifest-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("manifestExists reflects presence on disk", async () => {
  await withTmpDir(async (dir) => {
    const path = join(dir, "agents.yaml");
    assert.equal(await manifestExists(path), false);
    await writeFile(path, "dependencies: []\n");
    assert.equal(await manifestExists(path), true);
  });
});

test("loadManifest parses agents.yaml as a settings layer, naming the file in errors", async () => {
  await withTmpDir(async (dir) => {
    const path = join(dir, "agents.yaml");
    await writeFile(path, "targets:\n  claude: true\ndependencies:\n  - repo: owner/repo\n");
    assert.deepEqual(await loadManifest(path), {
      targets: { claude: true },
      dependencies: [{ repo: "owner/repo", ref: "main", skills: "*", agents: "*" }],
    });

    await writeFile(path, "dependencies:\n  - ref: main\n");
    await assert.rejects(() => loadManifest(path), new RegExp(`agents\\.yaml: dependency at index 0`));
  });
});

test("saveManifestDependencies round-trips through loadManifest and omits defaulted fields", async () => {
  await withTmpDir(async (dir) => {
    const path = join(dir, "nested", "agents.yaml");
    const dependencies: Dependency[] = [
      { repo: "owner/repo-a", ref: "main", skills: "*", agents: "*" },
      { repo: "owner/repo-b", ref: "v2", skills: ["x"], agents: false },
    ];
    await saveManifestDependencies(path, dependencies);

    assert.doesNotMatch(await readFile(path, "utf-8"), /ref: main/);
    assert.deepEqual((await loadManifest(path)).dependencies, dependencies);
  });
});

test("saveManifestDependencies keeps the file's other keys and comments", async () => {
  await withTmpDir(async (dir) => {
    const path = join(dir, "agents.yaml");
    await writeFile(
      path,
      "# project settings\ninstall_method: link\ntargets:\n  claude: true # also Claude\ndependencies:\n  - repo: owner/old\n"
    );

    await saveManifestDependencies(path, [{ repo: "owner/new", ref: "main", skills: "*", agents: "*" }]);

    const raw = await readFile(path, "utf-8");
    assert.match(raw, /# project settings/);
    assert.match(raw, /# also Claude/);
    assert.deepEqual(await loadManifest(path), {
      install_method: "link",
      targets: { claude: true },
      dependencies: [{ repo: "owner/new", ref: "main", skills: "*", agents: "*" }],
    });
  });
});

test("saveManifestDependencies writes into an empty existing file", async () => {
  await withTmpDir(async (dir) => {
    const path = join(dir, "agents.yaml");
    await writeFile(path, "");
    await saveManifestDependencies(path, [{ repo: "owner/new", ref: "main", skills: "*", agents: "*" }]);
    assert.equal((await loadManifest(path)).dependencies?.length, 1);
  });
});
