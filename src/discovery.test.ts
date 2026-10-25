import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkills, discoverAgents, filterItems } from "./discovery.ts";

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "agents-config-discovery-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("discoverSkills returns [] when there is no skills/ directory", async () => {
  await withTmpDir(async (repo) => {
    assert.deepEqual(await discoverSkills(repo), []);
  });
});

test("discoverSkills finds only subdirectories that contain SKILL.md, sorted by name", async () => {
  await withTmpDir(async (repo) => {
    await mkdir(join(repo, "skills", "zeta"), { recursive: true });
    await writeFile(join(repo, "skills", "zeta", "SKILL.md"), "# zeta");
    await mkdir(join(repo, "skills", "alpha"), { recursive: true });
    await writeFile(join(repo, "skills", "alpha", "SKILL.md"), "# alpha");
    await mkdir(join(repo, "skills", "no-skill-md"), { recursive: true });
    await writeFile(join(repo, "skills", "not-a-dir.md"), "stray file");

    const found = await discoverSkills(repo);
    assert.deepEqual(
      found.map((f) => f.name),
      ["alpha", "zeta"]
    );
    assert.equal(found[0]?.sourcePath, join(repo, "skills", "alpha"));
  });
});

test("discoverAgents finds subdirectories and top-level .md files, strips .md extension", async () => {
  await withTmpDir(async (repo) => {
    await mkdir(join(repo, "agents", "some-dir-agent"), { recursive: true });
    await writeFile(join(repo, "agents", "zeta.md"), "# zeta agent");
    await writeFile(join(repo, "agents", "alpha.md"), "# alpha agent");
    await writeFile(join(repo, "agents", "ignored.txt"), "not markdown");

    const found = await discoverAgents(repo);
    assert.deepEqual(
      found.map((f) => f.name),
      ["alpha", "some-dir-agent", "zeta"]
    );
  });
});

test("discoverAgents returns [] when there is no agents/ directory", async () => {
  await withTmpDir(async (repo) => {
    assert.deepEqual(await discoverAgents(repo), []);
  });
});

test("filterItems: false selection yields nothing and no missing entries", () => {
  const discovered = [{ name: "a", sourcePath: "/a" }];
  const result = filterItems(discovered, false);
  assert.deepEqual(result, { selected: [], missing: [] });
});

test("filterItems: '*' selection yields everything discovered", () => {
  const discovered = [
    { name: "a", sourcePath: "/a" },
    { name: "b", sourcePath: "/b" },
  ];
  const result = filterItems(discovered, "*");
  assert.deepEqual(result.selected, discovered);
  assert.deepEqual(result.missing, []);
});

test("filterItems: explicit list selects matches and reports missing names", () => {
  const discovered = [
    { name: "a", sourcePath: "/a" },
    { name: "b", sourcePath: "/b" },
  ];
  const result = filterItems(discovered, ["b", "c"]);
  assert.deepEqual(result.selected, [{ name: "b", sourcePath: "/b" }]);
  assert.deepEqual(result.missing, ["c"]);
});
