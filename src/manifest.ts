/**
 * Project manifest (agents.yaml) — the project settings layer (see layer.ts
 * for the schema it shares with config.yaml).
 *
 * The `dependencies` shape is agentdeps-compatible: existing agents.yaml files
 * need no migration.
 */
import { Document, parseDocument } from "yaml";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname } from "node:path";
import { isPathDependency, parseLayer, type Dependency, type Layer } from "./layer.ts";
import type { Provider } from "./di/index.ts";

export async function manifestExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function loadManifest(path: string): Promise<Layer> {
  return parseLayer(await readFile(path, "utf-8"), path);
}

function serializeDependency(dep: Dependency): Record<string, unknown> {
  const entry: Record<string, unknown> = isPathDependency(dep) ? { path: dep.path } : { repo: dep.repo };
  if (isPathDependency(dep) ? dep.ref !== undefined : dep.ref !== "main") entry["ref"] = dep.ref;
  if (dep.skills !== "*") entry["skills"] = dep.skills;
  if (dep.agents !== "*") entry["agents"] = dep.agents;
  if (dep.install_method !== undefined) entry["install_method"] = dep.install_method;
  return entry;
}

/**
 * Replace the manifest's `dependencies` list, leaving every other key (and
 * comments) in the file as it was — agents.yaml also carries the project's
 * targets and methods, which `add`/`remove` must not drop.
 */
export async function saveManifestDependencies(path: string, dependencies: readonly Dependency[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const existing = (await manifestExists(path)) ? parseDocument(await readFile(path, "utf-8")) : undefined;
  const doc = existing?.contents ? existing : new Document({});
  doc.set("dependencies", dependencies.map(serializeDependency));

  await writeFile(path, doc.toString({ lineWidth: 0 }), "utf-8");
}

/** Provider exposing manifest I/O as keyed definitions (the function references themselves). */
export function manifestProvider(): Provider {
  return {
    definitions: {
      "manifest/load": () => loadManifest,
      "manifest/save": () => saveManifestDependencies,
      "manifest/exists": () => manifestExists,
    },
  };
}
