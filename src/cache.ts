/**
 * Repo caching: clone/update dependency git repos into a cache directory,
 * keyed by owner-repo-ref so distinct refs of the same repo cache
 * independently.
 */
import { mkdir, rm, stat as fsStat } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Container, Provider } from "./di/index.ts";

const execFileAsync = promisify(execFile);

export function isShorthand(repo: string): boolean {
  if (repo.includes("://")) return false;
  if (repo.startsWith("git@")) return false;
  return repo.split("/").length - 1 === 1;
}

export function resolveRepoUrl(repo: string, cloneMethod: "ssh" | "https"): string {
  if (!isShorthand(repo)) return repo;
  return cloneMethod === "ssh" ? `git@github.com:${repo}.git` : `https://github.com/${repo}.git`;
}

export function deriveCacheKey(repo: string, ref: string): string {
  let ownerRepo: string;
  if (repo.startsWith("git@")) {
    ownerRepo = repo.slice(repo.indexOf(":") + 1);
  } else if (repo.includes("://")) {
    try {
      ownerRepo = new URL(repo).pathname.slice(1);
    } catch {
      ownerRepo = repo;
    }
  } else {
    ownerRepo = repo;
  }
  if (ownerRepo.endsWith(".git")) ownerRepo = ownerRepo.slice(0, -4);
  return `${ownerRepo.replace(/\//g, "-")}-${encodeURIComponent(ref)}`;
}

async function runGit(args: string[], cwd: string): Promise<{ success: boolean; stderr: string }> {
  try {
    await execFileAsync("git", args, { cwd });
    return { success: true, stderr: "" };
  } catch (err) {
    const stderr = err && typeof err === "object" && "stderr" in err ? String((err as { stderr: unknown }).stderr) : String(err);
    return { success: false, stderr };
  }
}

export async function checkGitAvailable(): Promise<boolean> {
  try {
    await execFileAsync("git", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await fsStat(path)).isDirectory();
  } catch {
    return false;
  }
}

export interface RepoResult {
  success: boolean;
  path: string;
  error?: string;
}

async function cloneRepo(url: string, ref: string, repoPath: string): Promise<RepoResult> {
  const home = join(repoPath, "..");
  const shallow = await runGit(["clone", "--branch", ref, "--single-branch", url, repoPath], home);
  if (shallow.success) return { success: true, path: repoPath };

  await rm(repoPath, { recursive: true, force: true });
  const full = await runGit(["clone", url, repoPath], home);
  if (!full.success) return { success: false, path: repoPath, error: full.stderr };

  const checkout = await runGit(["checkout", ref], repoPath);
  if (!checkout.success) {
    await rm(repoPath, { recursive: true, force: true });
    return { success: false, path: repoPath, error: `ref '${ref}' not found: ${checkout.stderr}` };
  }
  return { success: true, path: repoPath };
}

/**
 * Update an existing cache checkout to `ref`. Unlike a `reset --hard origin/<ref>`
 * (which only resolves for branches), this fetches `ref` by name directly and
 * checks it out detached — this works uniformly whether ref is a branch, tag, or
 * commit SHA, as long as the remote exposes it for fetch (GitHub does).
 */
async function updateRepo(repoPath: string, ref: string): Promise<RepoResult> {
  const fetchRef = await runGit(["fetch", "origin", ref], repoPath);
  if (fetchRef.success) {
    const checkout = await runGit(["checkout", "--detach", "FETCH_HEAD"], repoPath);
    if (checkout.success) return { success: true, path: repoPath };
  }

  // Fall back to a full fetch (covers refs the remote won't resolve by direct fetch).
  const fetchAll = await runGit(["fetch", "origin"], repoPath);
  if (!fetchAll.success) return { success: false, path: repoPath, error: fetchAll.stderr };

  const checkout = await runGit(["checkout", ref], repoPath);
  if (!checkout.success) {
    return { success: false, path: repoPath, error: `ref '${ref}' not found: ${checkout.stderr}` };
  }
  const resetToRemote = await runGit(["reset", "--hard", `origin/${ref}`], repoPath);
  if (!resetToRemote.success) {
    // Not a branch (tag/SHA) — checkout above already put us at the right commit.
    return { success: true, path: repoPath };
  }
  return { success: true, path: repoPath };
}

/**
 * Clone or update a cached checkout. `cacheDir` is supplied explicitly by
 * the caller — the `repo/ensure` container definition below closes over
 * `config/cacheDir` — rather than this function importing config.ts itself,
 * which was a module-to-module coupling (this file reaching into another
 * core module's internals instead of depending on a documented key).
 */
export async function ensureRepo(url: string, ref: string, cacheKey: string, cacheDir: string): Promise<RepoResult> {
  const repoPath = join(cacheDir, cacheKey);
  await mkdir(cacheDir, { recursive: true });

  if (await dirExists(repoPath)) {
    return updateRepo(repoPath, ref);
  }
  return cloneRepo(url, ref, repoPath);
}

export type EnsureRepoFn = (url: string, ref: string, cacheKey: string) => Promise<RepoResult>;

/**
 * Provider contributing repo/git operations as keyed definitions:
 *
 *  - repo/gitAvailable: `checkGitAvailable()`'s result, cached once resolved.
 *  - repo/ensure: `ensureRepo` bound to `config/cacheDir`, so callers never
 *    need to know or pass a cache directory themselves.
 */
export function repoProvider(): Provider {
  return {
    definitions: {
      "repo/gitAvailable": () => checkGitAvailable(),
      "repo/ensure": (c: Container): EnsureRepoFn => {
        const cacheDir = c.resolve<string>("config/cacheDir");
        return (url, ref, cacheKey) => ensureRepo(url, ref, cacheKey, cacheDir);
      },
    },
  };
}
