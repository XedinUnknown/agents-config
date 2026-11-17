/**
 * Discovery — scans a cached repo checkout for skills and agents, using the
 * same flat convention every harness actually scans on disk (confirmed against
 * OpenCode's discovery source and Claude Code's own skill loading):
 *
 *   skills: immediate subdirectories of skills/ containing SKILL.md
 *   agents: immediate subdirectories of agents/, or *.md files directly in agents/
 *
 * A dependency can name other folders through its `paths` (see layer.ts),
 * such as `.` for a repository that keeps its skills at the top level. The
 * folder must stay inside the dependency, symlinks included.
 *
 * This is deliberately the same shape agentdeps used for reading a source repo —
 * the bug agentdeps had was in how it *installed* these into the target, not in
 * how it read them from the source.
 */
import { readdir, access, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import type { Provider } from "./di/index.ts";

export interface DiscoveredItem {
  name: string;
  sourcePath: string;
}

/**
 * The entries of `dir` inside `root`, or undefined when it doesn't exist.
 * Throws when `dir` resolves outside `root`, e.g. through a symlink.
 */
async function readSourceDir(root: string, dir: string) {
  const full = join(root, dir);
  let real: string;
  try {
    real = await realpath(full);
  } catch {
    return undefined;
  }
  const inside = relative(await realpath(root), real);
  if (inside === ".." || inside.startsWith("../") || isAbsolute(inside)) {
    throw new Error(`${dir} resolves outside the dependency (${real})`);
  }
  try {
    return { path: full, entries: await readdir(full, { withFileTypes: true }) };
  } catch {
    return undefined;
  }
}

export async function discoverSkills(repoPath: string, dir = "skills"): Promise<DiscoveredItem[]> {
  const source = await readSourceDir(repoPath, dir);
  if (source === undefined) return [];
  const { path: skillsDir, entries } = source;

  const dirs = entries.filter((e) => e.isDirectory());
  const checks = await Promise.all(
    dirs.map(async (entry) => {
      try {
        await access(join(skillsDir, entry.name, "SKILL.md"));
        return { name: entry.name, sourcePath: join(skillsDir, entry.name) };
      } catch {
        return null;
      }
    })
  );

  return checks
    .filter((item): item is DiscoveredItem => item !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function discoverAgents(repoPath: string, dir = "agents"): Promise<DiscoveredItem[]> {
  const source = await readSourceDir(repoPath, dir);
  if (source === undefined) return [];
  const { path: agentsDir, entries } = source;

  const agents: DiscoveredItem[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      agents.push({ name: entry.name, sourcePath: join(agentsDir, entry.name) });
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      agents.push({ name: entry.name.replace(/\.md$/, ""), sourcePath: join(agentsDir, entry.name) });
    }
  }
  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

export function filterItems(
  discovered: readonly DiscoveredItem[],
  selection: "*" | string[] | false
): { selected: DiscoveredItem[]; missing: string[] } {
  if (selection === false) return { selected: [], missing: [] };
  if (selection === "*") return { selected: [...discovered], missing: [] };

  const byName = new Map(discovered.map((item) => [item.name, item]));
  const selected: DiscoveredItem[] = [];
  const missing: string[] = [];
  for (const name of selection) {
    const item = byName.get(name);
    if (item) selected.push(item);
    else missing.push(name);
  }
  return { selected, missing };
}

/** Provider exposing discovery as keyed definitions (the function references themselves). */
export function discoveryProvider(): Provider {
  return {
    definitions: {
      "discovery/skills": () => discoverSkills,
      "discovery/agents": () => discoverAgents,
      "discovery/filter": () => filterItems,
    },
  };
}
