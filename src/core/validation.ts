import { realpath } from "node:fs/promises";
import path from "node:path";
import { isSameOrInside, samePath } from "../shared/paths.js";
import { OperationError } from "./errors.js";

/** Refuse recursive self-copy and no-op copies into the source's own folder. */
export async function assertSafeDestination(source: string, destDir: string): Promise<void> {
  const name = path.basename(source);
  if (!name) throw new OperationError(`cannot use '${source}' as a source`);
  // Resolve the parent only, so a symlink source is treated as the link itself.
  const parent = await realpath(path.dirname(source));
  const realSource = path.join(parent, name);
  if (isSameOrInside(realSource, destDir)) {
    throw new OperationError(`cannot copy '${source}' into itself (target ${destDir} is inside it)`);
  }
  if (samePath(parent, destDir)) {
    throw new OperationError(`'${source}' is already in the target directory ${destDir}`);
  }
}
