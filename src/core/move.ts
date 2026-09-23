import { link, lstat, rename, rm, unlink } from "node:fs/promises";
import { copyEntry, lstatOrNull, type CopyContext } from "./copy.js";

/**
 * Move `src` to `dest`. The source is removed only after everything was copied;
 * if any item was skipped or anything failed, the source is left untouched.
 */
export async function moveEntry(src: string, dest: string, ctx: CopyContext): Promise<string | null> {
  if (!(await lstatOrNull(dest))) {
    const fast = await tryFastMove(src, dest);
    if (fast) {
      ctx.stats.copied++;
      return dest;
    }
  }
  const skippedBefore = ctx.stats.skipped;
  const finalDest = await copyEntry(src, dest, ctx);
  if (finalDest && ctx.stats.skipped === skippedBefore) {
    await rm(src, { recursive: true });
  }
  return finalDest;
}

/** Same-filesystem move that never overwrites. Returns false to fall back to copy+delete. */
async function tryFastMove(src: string, dest: string): Promise<boolean> {
  try {
    const st = await lstat(src);
    if (st.isDirectory()) {
      await rename(src, dest); // fails if dest is a non-empty dir; dest was checked absent
    } else {
      await link(src, dest); // atomic, never overwrites
      try {
        await unlink(src);
      } catch (e) {
        await unlink(dest).catch(() => {});
        throw e;
      }
    }
    return true;
  } catch {
    return false;
  }
}
