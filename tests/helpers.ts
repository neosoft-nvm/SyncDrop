import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import type { Config } from "../src/config/types.js";
import { validateConfig } from "../src/config/config.js";

const dirs: string[] = [];

export async function tmpDir(): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), "syncdrop-test-"));
  dirs.push(d);
  return d;
}

export function cleanupTmp(): void {
  afterEach(async () => {
    for (const d of dirs.splice(0)) {
      // restore permissions so cleanup works after permission tests
      await import("node:child_process").then(({ execFileSync }) => {
        try { execFileSync("chmod", ["-R", "u+rwx", d]); } catch { /* ignore */ }
      });
      await rm(d, { recursive: true, force: true });
    }
  });
}

export async function write(file: string, content = "x"): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

/** Sorted list of all files/dirs under `dir`, relative, dirs suffixed with '/'. */
export async function tree(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full);
    if (e.isDirectory()) out.push(rel + "/", ...(await tree(full, base)));
    else out.push(rel);
  }
  return out.sort();
}

export const read = (f: string) => readFile(f, "utf8");

export function makeConfig(targetPaths: Record<string, string>, defaults: object = {}): Config {
  const result = validateConfig({
    version: 1,
    targets: Object.fromEntries(
      Object.entries(targetPaths).map(([id, p]) => [id, { name: id.toUpperCase(), path: p, backend: "syncthing" }]),
    ),
    defaults,
  });
  if (!result.ok) throw new Error(result.error.join("; "));
  return result.value;
}
