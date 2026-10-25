import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLock, saveLock, lockPath, emptyLock, type LockFile } from "./lockfile.ts";

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "agents-config-lockfile-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const sampleLock: LockFile = {
  version: 2,
  skills: { foo: { repo: "owner/repo", ref: "main" } },
  agents: {},
  targets: {
    interop: {
      handler: "interop",
      state: { installs: { ".agents/skills/foo": { kind: "skills", name: "foo", method: "copy", contentHash: "abc" } } },
    },
  },
};

test("loadLock returns an empty lock when no file exists", async () => {
  await withTmpDir(async (dir) => {
    assert.deepEqual(await loadLock(dir), emptyLock());
  });
});

test("loadLock refuses an unreadable or unsupported file instead of forgetting ownership", async () => {
  await withTmpDir(async (dir) => {
    await writeFile(lockPath(dir), JSON.stringify({ version: 1, entries: { foo: {} } }));
    await assert.rejects(() => loadLock(dir), /unsupported lockfile format/);

    await writeFile(lockPath(dir), "not json");
    await assert.rejects(() => loadLock(dir));
  });
});

test("saveLock then loadLock round-trips, next to the project's agents.yaml", async () => {
  await withTmpDir(async (dir) => {
    await saveLock(dir, sampleLock);
    assert.equal(lockPath(dir), join(dir, "agents-lock.json"));
    assert.deepEqual(await loadLock(dir), sampleLock);
  });
});

test("saveLock removes the lockfile when nothing is recorded, and is a no-op with no file", async () => {
  await withTmpDir(async (dir) => {
    await saveLock(dir, emptyLock());
    assert.equal(await pathExists(lockPath(dir)), false);

    await saveLock(dir, sampleLock);
    await saveLock(dir, emptyLock());
    assert.equal(await pathExists(lockPath(dir)), false);
  });
});
