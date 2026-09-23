import { localBackend } from "./local.js";
import type { Backend } from "./types.js";

/**
 * Syncthing backend (MVP). The target directory is assumed to already be a Syncthing
 * folder; SyncDrop only writes files and Syncthing detects the change itself. No API,
 * no credentials, no assumptions about the Syncthing GUI or installation.
 */
export const syncthingBackend: Backend = {
  id: "syncthing",
  prepareTarget: (target) => localBackend.prepareTarget(target),
};
