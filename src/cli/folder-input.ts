import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { ArgsError, describeError } from "../core/errors.js";
import { expandPath } from "../shared/paths.js";
import type { CliIO } from "./cli.js";
import { isYes } from "./ui.js";

export interface KnownFolder {
  name: string;
  path: string;
}

const MAX_TRIES = 10; // also stops a loop if input ends and the same default keeps failing
const resolved = (p: string) => path.resolve(expandPath(p));

/** Validate a folder (offering to create it). Returns true if it was created. Throws ArgsError on a bad answer. */
export async function prepareFolder(io: CliIO, raw: string): Promise<boolean> {
  const dir = expandPath(raw);
  if (!path.isAbsolute(dir)) throw new ArgsError(`path must be absolute or start with ~ (got '${raw}')`);
  const info = await stat(dir).catch(() => undefined);
  if (info && !info.isDirectory()) throw new ArgsError(`${dir} exists but is not a folder`);
  if (info) return false;
  if (!io.interactive) {
    io.err(`warning: ${dir} does not exist yet; create it before using SyncDrop`);
    return false;
  }
  if (isYes(await io.ask(`${dir} does not exist. Create it? [Y/n]: `), true)) {
    await mkdir(dir, { recursive: true });
    return true;
  }
  // Declined: most likely a typo, so ask for the path again unless they really want it.
  if (!isYes(await io.ask("Use that path anyway, without creating it? [y/N]: "))) {
    throw new ArgsError(`no folder chosen for '${raw}'`);
  }
  io.err(`warning: ${dir} does not exist yet; create it before using SyncDrop`);
  return false;
}

/**
 * Ask for a folder path until it is usable. A bad answer is explained and asked again;
 * a folder that is already in `known` needs a yes. Returns null if the answer is empty and there is no default.
 */
export async function askFolderPath(
  io: CliIO,
  question: string,
  known: KnownFolder[],
  fallback?: string,
): Promise<{ raw: string; created: boolean } | null> {
  let lastError = "";
  for (let i = 0; i < MAX_TRIES; i++) {
    const raw = (await io.ask(question)).trim() || fallback;
    if (!raw) return null;
    const dup = known.find((k) => resolved(k.path) === resolved(raw));
    if (dup) {
      io.out(`That folder is already in the list as "${dup.name}".`);
      if (!isYes(await io.ask("Add it anyway? [y/N]: "))) continue;
    }
    try {
      return { raw, created: await prepareFolder(io, raw) };
    } catch (e) {
      lastError = describeError(e);
      io.err(`${lastError}. Please try again (folder paths look like ~/Documents or /home/you/Documents).`);
    }
  }
  throw new ArgsError(lastError || "no usable folder was given");
}

/**
 * Ask for the menu name; warns when it is already used and asks whether to keep it anyway.
 * An empty answer takes `fallback`; with no fallback it returns null (cancel).
 */
export async function askFolderName(io: CliIO, question: string, fallback: string, known: KnownFolder[]): Promise<string | null> {
  for (let i = 0; i < MAX_TRIES; i++) {
    const name = (await io.ask(question)).trim() || fallback;
    if (!name) return null;
    const dup = known.find((k) => k.name.trim().toLowerCase() === name.toLowerCase());
    if (!dup) return name;
    io.out(`The name "${name}" is already used by another folder (${dup.path}).`);
    if (isYes(await io.ask("Use that name anyway? [y/N]: "))) return name;
    io.out("Please pick a different name (or press Enter to cancel).");
  }
  throw new ArgsError("no unique name was chosen");
}
