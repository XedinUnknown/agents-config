/**
 * The built-in harness handlers — interop, claude, opencode, codex — and the
 * flat copy/link routine they share. Every built-in harness today installs by
 * placing each skill/agent flat into a directory the harness scans. This is
 * the core fix over agentdeps: no _agentdeps_managed/ nesting, so every
 * harness's native flat scanner finds what's installed.
 *
 * Each handler has its own default `paths: { skills, agents }` (relative to
 * the project directory); a target's config overrides either one, and an
 * absent or null value means the default.
 *
 * Each target's record in agents-lock.json lists every concrete path the
 * handler installed for it, so only those are ever updated or removed.
 */
import { mkdir, rm, cp, lstat, symlink, readlink, unlink, stat, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { hashPath } from "./hash.ts";
import type { Plan, DesiredItem } from "./plan.ts";
import {
  ITEM_KINDS,
  type HandlerContext,
  type ItemKind,
  type SyncReport,
  type Target,
  type TargetHandler,
} from "./registry.ts";
import type { Container, Provider } from "./di/index.ts";

export interface FilesPaths {
  readonly skills: string;
  readonly agents: string;
}

export interface FileInstall {
  kind: ItemKind;
  name: string;
  method: "copy" | "link";
  /** sha256 of the installed copy; empty for links, which always reflect the live source. */
  contentHash: string;
  installedAt: string;
  updatedAt: string;
}

/** A built-in handler's state: its target's record in agents-lock.json. */
export interface FilesState {
  installs?: Record<string, FileInstall>;
}

export interface SyncResult {
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: string[];
  /** Path exists on disk but isn't lock-owned — left alone, not overwritten. */
  skippedForeign: string[];
  /** Lock-owned, no longer desired, but changed on disk since install — left in place and still owned. */
  keptModified: string[];
}

/** An item to place; `method` overrides the run's install method for this item. */
export type FileItem = DesiredItem;

export interface FileItems {
  skills: readonly FileItem[];
  agents: readonly FileItem[];
}

interface Placement {
  kind: ItemKind;
  item: FileItem;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Hash of whatever is at `path`, or undefined when it can't be read (missing, dangling link). */
async function hashExisting(path: string): Promise<string | undefined> {
  try {
    return await hashPath(path);
  } catch {
    return undefined;
  }
}

function installedName(item: DesiredItem, sourceIsFile: boolean): string {
  if (!sourceIsFile) return item.name;
  const ext = item.sourcePath.match(/(\.[^./]+)$/)?.[1] ?? "";
  return item.name + ext;
}

async function ensureSymlink(
  target: string,
  linkPath: string,
  targetIsFile: boolean
): Promise<"created" | "replaced" | "unchanged"> {
  let existed = false;
  try {
    const st = await lstat(linkPath);
    existed = true;
    if (st.isSymbolicLink()) {
      if ((await readlink(linkPath)) === target) return "unchanged";
      await unlink(linkPath);
    } else {
      await rm(linkPath, { recursive: true, force: true });
    }
  } catch {
    // Doesn't exist — fall through to create.
  }
  await symlink(target, linkPath, targetIsFile ? "file" : "dir");
  return existed ? "replaced" : "created";
}

/**
 * What a link at `linkPath` should contain: a relative path when the source is
 * inside the project (e.g. a harness directory mirroring `.agents/`), so the
 * link survives moving or cloning the project; absolute otherwise (the
 * per-machine dependency cache).
 */
function linkTarget(projectDir: string, linkPath: string, sourcePath: string): string {
  const fromProject = relative(projectDir, sourcePath);
  const inside = fromProject !== "" && !fromProject.startsWith("..") && !isAbsolute(fromProject);
  return inside ? relative(dirname(linkPath), sourcePath) : sourcePath;
}

/** Every concrete path the plan should occupy, keyed relative to the project directory. */
async function placements(paths: FilesPaths, plan: FileItems): Promise<Map<string, Placement>> {
  const byPath = new Map<string, Placement>();
  for (const kind of ITEM_KINDS) {
    for (const item of plan[kind]) {
      const name = installedName(item, await isFile(item.sourcePath));
      byPath.set(join(paths[kind], name), { kind, item });
    }
  }
  return byPath;
}

/**
 * Remove a no-longer-desired lock-owned path, unless it changed on disk since
 * it was installed. Returns false when the path was kept.
 */
async function prune(abs: string, entry: FileInstall): Promise<boolean> {
  let st;
  try {
    st = await lstat(abs);
  } catch {
    return true; // Already gone.
  }
  if (entry.method === "link") {
    if (!st.isSymbolicLink()) return false;
    await unlink(abs);
    return true;
  }
  if (st.isSymbolicLink() || (await hashExisting(abs)) !== entry.contentHash) return false;
  await rm(abs, { recursive: true, force: true });
  return true;
}

/**
 * Sync the plan into one skills/agents directory pair, mutating `state` to match
 * what is on disk. The caller saves it — including when this throws partway,
 * so that whatever was already placed stays owned.
 */
export async function syncFiles(
  projectDir: string,
  paths: FilesPaths,
  plan: FileItems,
  installMethod: "link" | "copy",
  state: FilesState
): Promise<SyncResult> {
  const result: SyncResult = { added: [], updated: [], removed: [], unchanged: [], skippedForeign: [], keptModified: [] };
  const desired = await placements(paths, plan);
  const installs = (state.installs ??= {});

  for (const [path, entry] of Object.entries(installs)) {
    if (desired.has(path)) continue;
    if (await prune(join(projectDir, path), entry)) {
      delete installs[path];
      result.removed.push(path);
    } else {
      result.keptModified.push(path);
    }
  }

  for (const [path, { kind, item }] of desired) {
    const abs = join(projectDir, path);
    const prior = installs[path];

    if (!prior && (await pathExists(abs))) {
      result.skippedForeign.push(path);
      continue;
    }

    await mkdir(dirname(abs), { recursive: true });
    const now = new Date().toISOString();

    if ((item.method ?? installMethod) === "link") {
      const outcome = await ensureSymlink(linkTarget(projectDir, abs, item.sourcePath), abs, await isFile(item.sourcePath));
      installs[path] = {
        kind,
        name: item.name,
        method: "link",
        contentHash: "",
        installedAt: prior?.installedAt ?? now,
        updatedAt: outcome === "unchanged" && prior ? prior.updatedAt : now,
      };
      if (outcome === "unchanged" && prior) result.unchanged.push(path);
      else if (prior) result.updated.push(path);
      else result.added.push(path);
      continue;
    }

    const contentHash = await hashPath(item.sourcePath);
    const targetMatchesSource = (await hashExisting(abs)) === contentHash;

    if (prior && prior.method === "copy" && prior.contentHash === contentHash && targetMatchesSource) {
      result.unchanged.push(path);
      continue;
    }

    // Lock-owned content that is missing or locally modified is restored.
    await rm(abs, { recursive: true, force: true });
    await cp(item.sourcePath, abs, { recursive: true });
    installs[path] = {
      kind,
      name: item.name,
      method: "copy",
      contentHash,
      installedAt: prior?.installedAt ?? now,
      updatedAt: now,
    };
    if (prior) result.updated.push(path);
    else result.added.push(path);
  }

  if (Object.keys(installs).length === 0) delete state.installs;
  return result;
}

function resolvePaths(targetName: string, options: Readonly<Record<string, unknown>>, defaults: FilesPaths): FilesPaths {
  const raw = options["paths"];
  if (raw !== undefined && raw !== null && (typeof raw !== "object" || Array.isArray(raw))) {
    throw new Error(`Target '${targetName}': paths must be a map of skills/agents directories.`);
  }
  const paths = (raw ?? {}) as Record<string, unknown>;
  const resolved: Record<string, string> = {};
  for (const kind of ITEM_KINDS) {
    const value = paths[kind] ?? defaults[kind];
    if (typeof value !== "string" || value === "") {
      throw new Error(`Target '${targetName}': paths.${kind} must be a non-empty string.`);
    }
    resolved[kind] = value;
  }
  return resolved as unknown as FilesPaths;
}

/**
 * A handler whose installing can be reused by another: `installItems` installs
 * exactly the given items the way this harness does (its directories, its
 * install method), and `sync` is just `installItems` with the requested plan.
 * The `*-interop` handlers extend one of these (see interopVariant).
 */
export interface HarnessHandler extends TargetHandler {
  installItems(ctx: HandlerContext, items: FileItems): Promise<SyncReport>;
}

/**
 * A handler for a harness that scans flat skills/agents directories.
 * `unsupported` names kinds this harness can't use as-is, with the reason:
 * requested items of that kind are skipped with one warning per run, and any
 * previously installed ones are removed like other undesired items.
 */
export function flatDirectoryHandler(
  defaults: FilesPaths,
  unsupported: Partial<Record<ItemKind, string>> = {}
): HarnessHandler {
  const handler: HarnessHandler = {
    validate(target: Target) {
      resolvePaths(target.name, target.options, defaults);
    },
    async installItems(ctx, requested): Promise<SyncReport> {
      const paths = resolvePaths(ctx.targetName, ctx.options, defaults);
      const items: FileItems = { skills: [], agents: [] };
      const skipped: string[] = [];
      for (const kind of ITEM_KINDS) {
        const reason = unsupported[kind];
        if (reason === undefined) items[kind] = requested[kind];
        else if (requested[kind].length > 0) skipped.push(`${requested[kind].length} ${kind} not installed: ${reason}`);
      }
      const r = await syncFiles(ctx.projectDir, paths, items, ctx.installMethod, ctx.state as FilesState);
      return {
        added: r.added,
        updated: r.updated,
        removed: r.removed,
        unchanged: r.unchanged,
        warnings: [
          ...r.skippedForeign.map((p) => `${p} already exists and isn't tracked by agents-config — left untouched`),
          ...r.keptModified.map((p) => `${p} is no longer desired but was modified since install — left in place`),
          ...skipped,
        ],
      };
    },
    sync(ctx) {
      return handler.installItems(ctx, ctx.plan);
    },
  };
  return handler;
}

const INTEROP_PATHS: FilesPaths = { skills: ".agents/skills", agents: ".agents/agents" };

/** What a harness reads natively from the interop locations (`.agents/...`). */
interface InteropSupport {
  readonly skills: boolean;
  readonly agents: boolean;
}

type Unsupported = "symlink" | "install";

/** Entries currently in an interop directory, keyed by file name (agents keep their extension). */
async function interopEntries(dir: string, kind: ItemKind): Promise<Map<string, FileItem>> {
  const entries = new Map<string, FileItem>();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return entries;
  }
  for (const fileName of names.sort()) {
    if (fileName.startsWith(".")) continue;
    const sourcePath = join(dir, fileName);
    let st;
    try {
      st = await stat(sourcePath); // follows links; a dangling one is skipped
    } catch {
      continue;
    }
    const file = st.isFile();
    if (file ? kind === "skills" || !fileName.endsWith(".md") : !st.isDirectory()) continue;
    const name = file ? fileName.replace(/\.md$/, "") : fileName;
    entries.set(fileName, { name, sourcePath, origin: { path: dir }, method: "link" });
  }
  return entries;
}

function resolveUnsupported(target: { name: string; options: Readonly<Record<string, unknown>> }, fallback: Unsupported, symlinkAllowed: boolean): Unsupported {
  const value = target.options["unsupported"] ?? fallback;
  if (value !== "symlink" && value !== "install") {
    throw new Error(`Target '${target.name}': unsupported must be "symlink" or "install".`);
  }
  if (value === "symlink" && !symlinkAllowed) {
    throw new Error(`Target '${target.name}': unsupported: symlink isn't possible for this harness; use "install".`);
  }
  return value;
}

/**
 * The `*-interop` variant of a harness handler: the same harness, used
 * alongside the shared interop locations (`.agents/skills`,
 * `.agents/agents`), which an earlier target — normally `interop` — fills in
 * the same run. It decides *what* to install and leaves *how* to the base
 * handler. For each kind:
 *
 *  - if the harness reads the interop location natively, items already there
 *    are left to it;
 *  - if it doesn't, `unsupported: symlink` links every entry in the interop
 *    location — installed or hand-written — into the harness's own
 *    directory, so the harness sees exactly what interop has, while
 *    `unsupported: install` installs the requested items exactly as the base
 *    handler would;
 *  - requested items missing from the interop location are installed as the
 *    base handler would.
 *
 * Settings: the base handler's (e.g. `paths`), plus `interop_paths` (where to
 * look; default `.agents/skills`/`.agents/agents`) and `unsupported`.
 */
export function interopVariant(
  base: HarnessHandler,
  native: InteropSupport,
  unsupportedDefault: Unsupported,
  symlinkAllowed = true
): TargetHandler {
  return {
    validate(target: Target) {
      base.validate?.(target);
      resolveInteropPaths(target.name, target.options);
      resolveUnsupported(target, unsupportedDefault, symlinkAllowed);
    },
    async sync(ctx): Promise<SyncReport> {
      const interopPaths = resolveInteropPaths(ctx.targetName, ctx.options);
      const unsupported = resolveUnsupported({ name: ctx.targetName, options: ctx.options }, unsupportedDefault, symlinkAllowed);
      const items: { skills: FileItem[]; agents: FileItem[] } = { skills: [], agents: [] };

      for (const kind of ITEM_KINDS) {
        // A target being cleaned up mirrors nothing, so all its links go.
        const entries = ctx.enabled
          ? await interopEntries(join(ctx.projectDir, interopPaths[kind]), kind)
          : new Map<string, FileItem>();
        const mirror = !native[kind] && unsupported === "symlink";

        for (const item of ctx.plan[kind]) {
          const shared = entries.has(installedName(item, await isFile(item.sourcePath)));
          if (!shared || (!native[kind] && !mirror)) items[kind].push(item);
        }
        if (mirror) items[kind].push(...entries.values());
      }

      return base.installItems(ctx, items);
    },
  };
}

/** Resolve a harness handler to extend, failing clearly if it can't be extended. */
function baseHarness(c: Container, name: string): HarnessHandler {
  const handler = c.resolve<TargetHandler>(`handler/${name}`);
  if (typeof (handler as Partial<HarnessHandler>).installItems !== "function") {
    throw new Error(`The '${name}' handler can't be extended by '${name}-interop': it has no installItems().`);
  }
  return handler as HarnessHandler;
}

function resolveInteropPaths(targetName: string, options: Readonly<Record<string, unknown>>): FilesPaths {
  const raw = options["interop_paths"];
  return resolvePaths(targetName, raw === undefined || raw === null ? {} : { paths: raw }, INTEROP_PATHS);
}

/**
 * Evidence for each built-in's defaults:
 *
 * - interop: not tied to one CLI binary — a neutral drop point for the
 *   `.agents/skills` convention, which OpenCode and Codex read natively
 *   (OpenCode and Codex docs, plus probes 2026-10-25). No harness reads
 *   `.agents/agents`.
 * - claude: documented Claude Code convention (`.claude/skills`,
 *   `.claude/agents`); confirmed empty-but-present ~/.claude/skills and
 *   ~/.claude/agents on this machine (2026-08-22).
 * - opencode: its own directories, per opencode.ai/docs/skills and
 *   opencode.ai/docs/agents (2026-10-24): skills in `.opencode/skills`, agents
 *   ONLY in `.opencode/agents` (it doesn't read `.agents/agents` or
 *   `.claude/agents`). Its agent file format differs from Claude Code's (no
 *   `name`, `mode`, tool permissions as a map) — agents are copied unchanged,
 *   so an agent written for Claude Code may need converting; that conversion
 *   belongs in this handler.
 * - codex: Codex 0.149.0 loads skills from `.codex/skills` as well as
 *   `.agents/skills` (probe with `codex debug prompt-input`, 2026-10-25;
 *   `.codex/skills` isn't in its docs). Agents are TOML files in
 *   `.codex/agents` per its docs, so Markdown agents aren't installed (with a
 *   warning) until conversion exists; no probe confirmed project agents load
 *   at all.
 */
export function installProvider(): Provider {
  return {
    definitions: {
      "handler/interop": () => flatDirectoryHandler({ skills: ".agents/skills", agents: ".agents/agents" }),
      "handler/claude": () => flatDirectoryHandler({ skills: ".claude/skills", agents: ".claude/agents" }),
      "handler/opencode": () => flatDirectoryHandler({ skills: ".opencode/skills", agents: ".opencode/agents" }),
      "handler/codex": () =>
        flatDirectoryHandler(
          { skills: ".codex/skills", agents: ".codex/agents" },
          { agents: "Codex agents are TOML files; converting Markdown agents isn't implemented" }
        ),
      // Each *-interop handler extends whatever `handler/<harness>` currently
      // resolves to, so a module overriding e.g. `claude` changes both.
      "handler/claude-interop": (c: Container) =>
        interopVariant(baseHarness(c, "claude"), { skills: false, agents: false }, "symlink"),
      "handler/opencode-interop": (c: Container) =>
        interopVariant(baseHarness(c, "opencode"), { skills: true, agents: false }, "symlink"),
      // Codex agents are TOML, so linking the interop Markdown agents is useless.
      "handler/codex-interop": (c: Container) =>
        interopVariant(baseHarness(c, "codex"), { skills: true, agents: false }, "install", false),
    },
  };
}
