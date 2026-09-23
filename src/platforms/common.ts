import { isSea } from "node:sea";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import type { CliInvocation } from "./types.js";

export function defaultCli(): CliInvocation {
  // Packaged binary: the executable is SyncDrop itself; there is no separate script.
  if (isSea()) return { node: process.execPath };
  return {
    node: process.execPath,
    script: fileURLToPath(new URL("../cli/main.js", import.meta.url)),
  };
}

export const xdgConfigHome = (env = process.env) => env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
export const xdgDataHome = (env = process.env) => env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");

/** Marker used to recognise (and cleanly replace/remove) entries SyncDrop created. */
export const MARKER = "syncdrop";
