import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  isShorthand,
  resolveRepoUrl,
  deriveCacheKey,
  checkGitAvailable,
  ensureRepo,
  repoProvider,
} from "./cache.ts";
import { bootstrap, type Provider } from "./di/index.ts";

const execFileAsync = promisify(execFile);

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "agents-config-cache-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

async function git(args: string[], cwd: string): Promise<void> {
  await execFileAsync("git", args, { cwd, env: gitEnv });
}

test("isShorthand recognizes owner/repo but not URLs, SSH refs, or bare names", () => {
  assert.equal(isShorthand("owner/repo"), true);
  assert.equal(isShorthand("https://github.com/owner/repo.git"), false);
  assert.equal(isShorthand("git@github.com:owner/repo.git"), false);
  assert.equal(isShorthand("just-a-name"), false);
  assert.equal(isShorthand("a/b/c"), false);
});

test("resolveRepoUrl expands shorthand per clone_method, passes URLs through unchanged", () => {
  assert.equal(resolveRepoUrl("owner/repo", "https"), "https://github.com/owner/repo.git");
  assert.equal(resolveRepoUrl("owner/repo", "ssh"), "git@github.com:owner/repo.git");
  assert.equal(resolveRepoUrl("git@github.com:owner/repo.git", "https"), "git@github.com:owner/repo.git");
  assert.equal(resolveRepoUrl("https://example.com/owner/repo.git", "ssh"), "https://example.com/owner/repo.git");
});

test("deriveCacheKey normalizes owner/repo across shorthand, https, and ssh forms", () => {
  assert.equal(deriveCacheKey("owner/repo", "main"), "owner-repo-main");
  assert.equal(deriveCacheKey("https://github.com/owner/repo.git", "main"), "owner-repo-main");
  assert.equal(deriveCacheKey("git@github.com:owner/repo.git", "v1"), "owner-repo-v1");
});

test("deriveCacheKey keeps branch refs inside one cache directory", () => {
  assert.equal(deriveCacheKey("owner/repo", "feature/example"), "owner-repo-feature%2Fexample");
  assert.equal(deriveCacheKey("owner/repo", "../../outside"), "owner-repo-..%2F..%2Foutside");
});

test("checkGitAvailable is true in this environment", async () => {
  assert.equal(await checkGitAvailable(), true);
});

test("ensureRepo clones a local repo then updates the cache in place on a second call", async () => {
  await withTmpDir(async (root) => {
    const sourceRepo = join(root, "source");
    await mkdir(sourceRepo, { recursive: true });
    await git(["init", "-b", "main"], sourceRepo);
    await mkdir(join(sourceRepo, "skills", "foo"), { recursive: true });
    await writeFile(join(sourceRepo, "skills", "foo", "SKILL.md"), "v1");
    await git(["add", "."], sourceRepo);
    await git(["commit", "-m", "v1"], sourceRepo);

    const cacheDir = join(root, "cache");

    const first = await ensureRepo(sourceRepo, "main", "test-repo-main", cacheDir);
    assert.equal(first.success, true);
    assert.equal(await readFile(join(first.path, "skills", "foo", "SKILL.md"), "utf-8"), "v1");

    await writeFile(join(sourceRepo, "skills", "foo", "SKILL.md"), "v2");
    await git(["add", "."], sourceRepo);
    await git(["commit", "-m", "v2"], sourceRepo);

    const second = await ensureRepo(sourceRepo, "main", "test-repo-main", cacheDir);
    assert.equal(second.success, true);
    assert.equal(second.path, first.path);
    assert.equal(await readFile(join(second.path, "skills", "foo", "SKILL.md"), "utf-8"), "v2");
  });
});

test("ensureRepo reports failure for a ref that doesn't exist", async () => {
  await withTmpDir(async (root) => {
    const sourceRepo = join(root, "source");
    await mkdir(sourceRepo, { recursive: true });
    await git(["init", "-b", "main"], sourceRepo);
    await writeFile(join(sourceRepo, "readme.txt"), "hi");
    await git(["add", "."], sourceRepo);
    await git(["commit", "-m", "init"], sourceRepo);

    const cacheDir = join(root, "cache");
    const result = await ensureRepo(sourceRepo, "does-not-exist", "test-repo-missing-ref", cacheDir);
    assert.equal(result.success, false);
    assert.ok(result.error);
  });
});

test("repoProvider's repo/ensure binds config/cacheDir so callers don't pass a cache dir themselves", async () => {
  await withTmpDir(async (root) => {
    const sourceRepo = join(root, "source");
    await mkdir(sourceRepo, { recursive: true });
    await git(["init", "-b", "main"], sourceRepo);
    await writeFile(join(sourceRepo, "readme.txt"), "hi");
    await git(["add", "."], sourceRepo);
    await git(["commit", "-m", "init"], sourceRepo);

    const cacheDir = join(root, "cache");
    const container = bootstrap(
      new Map<string, Provider>([
        ["config", { definitions: { "config/cacheDir": () => cacheDir } }],
        ["repo", repoProvider()],
      ])
    );

    const ensure = container.resolve<(url: string, ref: string, cacheKey: string) => Promise<{ success: boolean; path: string }>>(
      "repo/ensure"
    );
    const result = await ensure(sourceRepo, "main", "test-repo-bound");
    assert.equal(result.success, true);
    assert.equal(result.path, join(cacheDir, "test-repo-bound"));
  });
});

test("repoProvider's repo/gitAvailable resolves checkGitAvailable's result", async () => {
  const container = bootstrap(new Map<string, Provider>([["repo", repoProvider()]]));
  assert.equal(await container.resolve<Promise<boolean>>("repo/gitAvailable"), true);
});
