/** Content hashing for change detection — real digests, not size/mtime heuristics. */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Provider } from "./di/index.ts";

async function listFiles(root: string, dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, full)));
    } else if (entry.isFile()) {
      files.push(relative(root, full));
    }
  }
  return files;
}

export async function hashPath(path: string): Promise<string> {
  const st = await stat(path);
  const hash = createHash("sha256");

  if (st.isFile()) {
    hash.update(await readFile(path));
    return hash.digest("hex");
  }

  const files = (await listFiles(path, path)).sort();
  for (const rel of files) {
    hash.update(rel);
    hash.update("\0");
    hash.update(await readFile(join(path, rel)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Provider exposing content hashing as a keyed definition (the function reference itself). */
export function hashProvider(): Provider {
  return {
    definitions: {
      "hash/hashPath": () => hashPath,
    },
  };
}
