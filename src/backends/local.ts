import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { ConfigError, OperationError, isErrno } from "../core/errors.js";
import type { Backend } from "./types.js";

/** Plain directory target. Also the base for other filesystem-watching backends. */
export const localBackend: Backend = {
  id: "local",
  async prepareTarget(target) {
    let info;
    try {
      info = await stat(target.path);
    } catch (e) {
      if (isErrno(e, "ENOENT")) {
        throw new ConfigError(
          `target '${target.id}': directory does not exist: ${target.path} (create it first)`,
        );
      }
      throw e;
    }
    if (!info.isDirectory()) {
      throw new ConfigError(`target '${target.id}': not a directory: ${target.path}`);
    }
    try {
      await access(target.path, constants.W_OK);
    } catch {
      throw new OperationError(`target '${target.id}': no write permission for ${target.path}`);
    }
    return realpath(target.path);
  },
};
