/**
 * Discovery — scans a cached repo checkout for skills and agents, using the
 * same flat convention every harness actually scans on disk (confirmed against
 * OpenCode's discovery source and Claude Code's own skill loading):
 *
 *   skills: immediate subdirectories of skills/ containing SKILL.md
 *   agents: immediate subdirectories of agents/, or *.md files directly in agents/
 *
 * This is deliberately the same shape agentdeps used for reading a source repo —
 * the bug agentdeps had was in how it *installed* these into the target, not in
 * how it read them from the source.
 */
import { readdir, access } from "node:fs/promises";
import { join } from "node:path";
import type { Provider } from "./di/index.ts";

export interface DiscoveredItem {
  name: string;
  sourcePath: string;
}

export async function discoverSkills(repoPath: string): Promise<DiscoveredItem[]> {
  const skillsDir = join(repoPath, "skills");

  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

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

export async function discoverAgents(repoPath: string): Promise<DiscoveredItem[]> {
  const agentsDir = join(repoPath, "agents");

  let entries;
  try {
    entries = await readdir(agentsDir, { withFileTypes: true });
  } catch {
    return [];
  }

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
