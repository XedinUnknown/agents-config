import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPath } from "./hash.ts";

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "agents-config-hash-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("hashPath is stable for identical file content", async () => {
  await withTmpDir(async (dir) => {
    const file = join(dir, "a.txt");
    await writeFile(file, "hello");
    const h1 = await hashPath(file);
    const h2 = await hashPath(file);
    assert.equal(h1, h2);
  });
});

test("hashPath changes when file content changes", async () => {
  await withTmpDir(async (dir) => {
    const file = join(dir, "a.txt");
    await writeFile(file, "hello");
    const h1 = await hashPath(file);
    await writeFile(file, "goodbye");
    const h2 = await hashPath(file);
    assert.notEqual(h1, h2);
  });
});

test("hashPath is stable for a directory regardless of file creation order", async () => {
  await withTmpDir(async (dir) => {
    const dirA = join(dir, "a");
    const dirB = join(dir, "b");
    await mkdir(join(dirA, "nested"), { recursive: true });
    await mkdir(join(dirB, "nested"), { recursive: true });

    await writeFile(join(dirA, "one.txt"), "1");
    await writeFile(join(dirA, "nested", "two.txt"), "2");

    // Same content, opposite write order.
    await writeFile(join(dirB, "nested", "two.txt"), "2");
    await writeFile(join(dirB, "one.txt"), "1");

    const hA = await hashPath(dirA);
    const hB = await hashPath(dirB);
    assert.equal(hA, hB);
  });
});

test("hashPath for a directory differs when a nested file's content differs", async () => {
  await withTmpDir(async (dir) => {
    const dirA = join(dir, "a");
    const dirB = join(dir, "b");
    await mkdir(dirA, { recursive: true });
    await mkdir(dirB, { recursive: true });
    await writeFile(join(dirA, "one.txt"), "1");
    await writeFile(join(dirB, "one.txt"), "2");

    const hA = await hashPath(dirA);
    const hB = await hashPath(dirB);
    assert.notEqual(hA, hB);
  });
});
