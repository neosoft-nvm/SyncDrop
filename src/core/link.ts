import { lstat, rm, symlink } from "node:fs/promises";
import { decide, lstatOrNull, type CopyContext } from "./copy.js";
import { keepBothName } from "./conflicts.js";
import { OperationError, isErrno } from "./errors.js";

/**
 * Create a symbolic link at `dest` pointing to `src`; the source is never touched.
 * Returns the final path, or null if skipped. Only an existing link may be overwritten
 * (a real file or folder would be lost), so use keep-both or skip for those.
 */
export async function linkEntry(src: string, dest: string, ctx: CopyContext): Promise<string | null> {
  const destStat = await lstatOrNull(dest);
  if (!destStat) return create(src, dest, false, ctx);

  switch (await decide(ctx, src, dest)) {
    case "skip":
      ctx.stats.skipped++;
      return null;
    case "keep-both":
      return create(src, dest, true, ctx, (await lstat(src)).isDirectory());
    case "overwrite":
      if (!destStat.isSymbolicLink()) {
        throw new OperationError(`cannot replace '${dest}' with a link: it is a real ${destStat.isDirectory() ? "folder" : "file"} (use --conflict keep-both)`);
      }
      await rm(dest);
      return create(src, dest, false, ctx);
  }
}

async function create(src: string, dest: string, keepBoth: boolean, ctx: CopyContext, isDir = false): Promise<string> {
  let target = dest;
  for (let n = 1; ; n++) {
    try {
      await symlink(src, target);
      ctx.stats.copied++;
      return target;
    } catch (e) {
      if (!keepBoth || !isErrno(e, "EEXIST") || n >= 10_000) throw e;
      target = keepBothName(dest, n, isDir);
    }
  }
}
