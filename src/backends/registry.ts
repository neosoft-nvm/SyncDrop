import { ConfigError } from "../core/errors.js";
import { localBackend } from "./local.js";
import { syncthingBackend } from "./syncthing.js";
import type { Backend } from "./types.js";

const backends: Record<string, Backend> = {
  local: localBackend,
  syncthing: syncthingBackend,
};

export function getBackend(id: string): Backend {
  const backend = backends[id];
  if (!backend) throw new ConfigError(`unknown backend '${id}'`);
  return backend;
}
