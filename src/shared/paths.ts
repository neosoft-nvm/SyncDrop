import { constants } from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface ExpandOptions {
  home?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

/** Expand `~` (and `%VAR%` on Windows). Does not resolve relative paths. */
export function expandPath(input: string, opts: ExpandOptions = {}): string {
  const home = opts.home ?? os.homedir();
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  let p = input.trim();
  if (platform === "win32") p = p.replace(/%([^%]+)%/g, (m, name: string) => env[name] ?? m);
  if (p === "~") return home;
  if (p.startsWith("~/") || (platform === "win32" && p.startsWith("~\\"))) {
    return path.join(home, p.slice(2));
  }
  return p;
}

/** True when `child` equals `parent` or lies inside it. Purely lexical. */
export function isSameOrInside(
  parent: string,
  child: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const norm = (p: string) => (platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  const a = norm(parent);
  const b = norm(child);
  if (a === b) return true;
  const rel = path.relative(a, b);
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}

export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const norm = (p: string) => (platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === "win32") {
    return path.join(env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "syncdrop");
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "syncdrop");
}

export function configFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.SYNCDROP_CONFIG || path.join(configDir(env), "config.json");
}

export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === "win32") {
    return path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "syncdrop");
  }
  return path.join(env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "syncdrop");
}

export function historyFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.SYNCDROP_HISTORY || path.join(stateDir(env), "history.jsonl");
}

/** Locate an executable on PATH. */
export async function which(cmd: string, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const exts = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD").split(";") : [""];
  for (const dir of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return undefined;
}
