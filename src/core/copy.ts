import { randomBytes } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { copyFile, link, lstat, mkdir, readdir, readlink, rename, rm, symlink, utimes } from "node:fs/promises";
import path from "node:path";
import type { ConflictPolicy } from "../config/types.js";
import { keepBothName, type ConflictResolver, type ResolvedPolicy } from "./conflicts.js";
import { ConflictError, OperationError, isErrno } from "./errors.js";

export interface CopyContext {
  /** Current policy; may change to a concrete one if the user picks "apply to all". */
  policy: ConflictPolicy;
  resolve?: ConflictResolver;
  stats: { copied: number; skipped: number };
}

export async function lstatOrNull(p: string): Promise<Stats | null> {
  try {
    return await lstat(p);
  } catch (e) {
    if (isErrno(e, "ENOENT")) return null;
    throw e;
  }
}

async function decide(ctx: CopyContext, source: string, destination: string): Promise<ResolvedPolicy> {
  if (ctx.policy !== "ask") return ctx.policy;
  if (!ctx.resolve) {
    throw new ConflictError(
      `'${destination}' already exists. Re-run with --conflict overwrite|skip|keep-both.`,
    );
  }
  const answer = await ctx.resolve({ source, destination });
  if (answer.applyToAll) ctx.policy = answer.policy;
  return answer.policy;
}

/**
 * Copy `src` to exactly `dest`, applying the conflict policy if `dest` exists.
 * Returns the final path, or null if the entry was skipped.
 * Existing directories are merged; files inside are handled per policy.
 */
export async function copyEntry(src: string, dest: string, ctx: CopyContext): Promise<string | null> {
  const srcStat = await lstat(src);
  const destStat = await lstatOrNull(dest);

  if (!destStat) return writeNew(src, srcStat, dest, ctx, false);

  if (srcStat.isDirectory() && destStat.isDirectory()) {
    await copyDirContents(src, dest, ctx);
    return dest;
  }

  const policy = await decide(ctx, src, dest);
  switch (policy) {
    case "skip":
      ctx.stats.skipped++;
      return null;
    case "keep-both":
      return writeNew(src, srcStat, dest, ctx, true);
    case "overwrite": {
      if (srcStat.isDirectory() || destStat.isDirectory()) {
        throw new OperationError(`cannot overwrite '${dest}': file/directory type mismatch (use --conflict keep-both)`);
      }
      if (srcStat.isSymbolicLink()) {
        await rm(dest);
        await symlink(await readlink(src), dest);
      } else {
        await placeFile(src, srcStat, dest, false);
      }
      ctx.stats.copied++;
      return dest;
    }
  }
}

async function copyDirContents(src: string, dest: string, ctx: CopyContext): Promise<void> {
  for (const name of await readdir(src)) {
    await copyEntry(path.join(src, name), path.join(dest, name), ctx);
  }
}

async function writeNew(
  src: string,
  st: Stats,
  dest: string,
  ctx: CopyContext,
  keepBoth: boolean,
): Promise<string> {
  let target = dest;
  for (let n = 1; ; n++) {
    try {
      await createExclusive(src, st, target);
      break;
    } catch (e) {
      if (!keepBoth || !isErrno(e, "EEXIST") || n >= 10_000) throw e;
      target = keepBothName(dest, n, st.isDirectory());
    }
  }
  if (st.isDirectory()) {
    await copyDirContents(src, target, ctx);
    await utimes(target, st.atime, st.mtime);
  }
  ctx.stats.copied++;
  return target;
}

/** Create `dest` (file, empty dir, or symlink) failing with EEXIST if it already exists. */
async function createExclusive(src: string, st: Stats, dest: string): Promise<void> {
  if (st.isDirectory()) return void (await mkdir(dest));
  if (st.isSymbolicLink()) return symlink(await readlink(src), dest);
  if (st.isFile()) return placeFile(src, st, dest, true);
  throw new OperationError(`unsupported file type (socket, pipe or device): ${src}`);
}

/**
 * Write a file via a temp file in the destination directory, then publish it atomically,
 * so a failed or interrupted copy never leaves a partial file for the sync tool to pick up.
 */
async function placeFile(src: string, st: Stats, dest: string, exclusive: boolean): Promise<void> {
  const tmp = path.join(
    path.dirname(dest),
    `.${path.basename(dest)}.syncdrop-${randomBytes(4).toString("hex")}.tmp`,
  );
  let tmpExists = false;
  try {
    await copyFile(src, tmp, constants.COPYFILE_EXCL);
    tmpExists = true;
    await utimes(tmp, st.atime, st.mtime);
    if (!exclusive) {
      await rename(tmp, dest);
      tmpExists = false;
      return;
    }
    try {
      await link(tmp, dest); // atomic, fails with EEXIST rather than overwriting
    } catch (e) {
      if (isErrno(e, "EEXIST")) throw e;
      // Filesystem without hard links (e.g. FAT/exFAT): fall back to check-then-rename.
      if (await lstatOrNull(dest)) throw Object.assign(new Error("exists"), { code: "EEXIST", path: dest });
      await rename(tmp, dest);
      tmpExists = false;
    }
  } finally {
    if (tmpExists) await rm(tmp, { force: true });
  }
}
