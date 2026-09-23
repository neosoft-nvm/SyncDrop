import type { ConfigFile } from "./types.js";

/** Keep identical to config/default.json (enforced by a test). */
export const DEFAULT_CONFIG: ConfigFile = {
  version: 1,
  targets: {
    main: { name: "Main Sync", path: "~/SyncDrop", backend: "syncthing" },
    projects: { name: "Projects", path: "~/SyncDrop/Projects", backend: "syncthing" },
    documents: { name: "Documents", path: "~/SyncDrop/Documents", backend: "syncthing" },
  },
  defaults: { operation: "copy", target: "main", conflict: "ask" },
};
