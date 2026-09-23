import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ConfigError, isErrno } from "../core/errors.js";
import { configFilePath, expandPath } from "../shared/paths.js";
import { err, ok, type Result } from "../shared/result.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import {
  BACKEND_IDS,
  CONFLICT_POLICIES,
  OPERATIONS,
  type BackendId,
  type ConfigFile,
  type Config,
  type ConflictPolicy,
  type Operation,
  type SyncTarget,
} from "./types.js";

export const SUPPORTED_CONFIG_VERSION = 1;
const ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Validate a parsed config. Collects every problem rather than stopping at the first. */
export function validateConfig(raw: unknown): Result<Config, string[]> {
  const errors: string[] = [];
  if (!isObject(raw)) return err(["config must be a JSON object"]);

  if (raw.version !== SUPPORTED_CONFIG_VERSION) {
    errors.push(`unsupported config version ${JSON.stringify(raw.version)} (expected ${SUPPORTED_CONFIG_VERSION})`);
  }
  if (!isObject(raw.targets)) {
    errors.push("'targets' must be an object");
    return err(errors);
  }

  const targets: Record<string, SyncTarget> = {};
  const seen = new Map<string, string>();
  for (const [id, t] of Object.entries(raw.targets)) {
    if (!ID_RE.test(id)) {
      errors.push(`invalid target id '${id}' (use letters, digits, '-' or '_')`);
      continue;
    }
    const lower = id.toLowerCase();
    if (seen.has(lower)) {
      errors.push(`duplicate target id '${id}' (conflicts with '${seen.get(lower)}')`);
      continue;
    }
    seen.set(lower, id);
    if (!isObject(t)) {
      errors.push(`target '${id}' must be an object`);
      continue;
    }
    if (typeof t.name !== "string" || !t.name.trim()) errors.push(`target '${id}': 'name' is required`);
    if (typeof t.path !== "string" || !t.path.trim()) {
      errors.push(`target '${id}': 'path' is required`);
      continue;
    }
    if (!BACKEND_IDS.includes(t.backend as BackendId)) {
      errors.push(`target '${id}': unknown backend ${JSON.stringify(t.backend)} (known: ${BACKEND_IDS.join(", ")})`);
    }
    const resolved = expandPath(t.path);
    if (!path.isAbsolute(resolved)) {
      errors.push(`target '${id}': path '${t.path}' must be absolute or start with '~'`);
      continue;
    }
    targets[id] = {
      id,
      name: String(t.name ?? id),
      path: path.resolve(resolved),
      backend: t.backend as BackendId,
    };
  }

  const d = isObject(raw.defaults) ? raw.defaults : {};
  const operation = (d.operation ?? "copy") as Operation;
  const conflict = (d.conflict ?? "ask") as ConflictPolicy;
  const target = typeof d.target === "string" ? d.target : Object.keys(targets)[0] ?? "";
  if (!OPERATIONS.includes(operation)) errors.push(`defaults.operation must be one of: ${OPERATIONS.join(", ")}`);
  if (!CONFLICT_POLICIES.includes(conflict)) errors.push(`defaults.conflict must be one of: ${CONFLICT_POLICIES.join(", ")}`);
  if (target && !(target in targets) && errors.length === 0) errors.push(`defaults.target '${target}' is not a defined target`);

  if (errors.length) return err(errors);
  return ok({
    version: raw.version as number,
    targets,
    defaults: { operation, conflict, target },
    raw: raw as Config["raw"],
  });
}

export async function loadConfig(file: string = configFilePath()): Promise<Config> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if (isErrno(e, "ENOENT")) {
      throw new ConfigError(`no configuration found at ${file}. Run 'syncdrop config init' to create one.`);
    }
    throw new ConfigError(`cannot read configuration ${file}: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`invalid JSON in ${file}: ${(e as Error).message}`);
  }
  const result = validateConfig(parsed);
  if (!result.ok) throw new ConfigError(`invalid configuration ${file}:\n  - ${result.error.join("\n  - ")}`);
  return result.value;
}

/** Write the default config, or one "main" target at `syncFolder`. Refuses to overwrite unless `force`. */
export async function writeDefaultConfig(file: string = configFilePath(), force = false, syncFolder?: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const config: ConfigFile = syncFolder
    ? { ...DEFAULT_CONFIG, targets: { main: { name: "Main Sync", path: syncFolder, backend: "syncthing" } } }
    : DEFAULT_CONFIG;
  try {
    await writeFile(file, JSON.stringify(config, null, 2) + "\n", { flag: force ? "w" : "wx" });
  } catch (e) {
    if (isErrno(e, "EEXIST")) throw new ConfigError(`${file} already exists (use --force to overwrite)`);
    throw e;
  }
}
