import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ConfigError } from "../core/errors.js";
import { configFilePath } from "../shared/paths.js";
import { loadConfig, validateConfig } from "./config.js";
import { BACKEND_IDS, OPERATIONS, type Config, type ConfigFile, type ConflictPolicy, type Operation } from "./types.js";

/**
 * Edits go through the raw config file so unknown fields survive. Every edit is
 * validated before it is written; an invalid result changes nothing.
 */
export async function editConfig(change: (raw: ConfigFile, current: Config) => void, file = configFilePath()): Promise<Config> {
  const current = await loadConfig(file);
  const raw = structuredClone(current.raw);
  change(raw, current);
  const result = validateConfig(raw);
  if (!result.ok) throw new ConfigError(`refusing to save an invalid configuration:\n  - ${result.error.join("\n  - ")}`);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(raw, null, 2) + "\n");
  await rename(tmp, file); // never leave a half-written config behind
  return result.value;
}

const setOrder = (raw: ConfigFile, order: string[]) => {
  raw.menu = { ...raw.menu, order };
};

/** Turn a display name into a valid, unused target id. */
export function makeTargetId(name: string, used: Iterable<string>): string {
  const taken = new Set([...used].map((u) => u.toLowerCase()));
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "folder";
  let id = base;
  for (let k = 2; taken.has(id); k++) id = `${base}-${k}`;
  return id;
}

export const addTarget = (id: string, name: string, dir: string, file?: string) =>
  editConfig((raw, cur) => {
    if (id in raw.targets) throw new ConfigError(`target '${id}' already exists`);
    raw.targets[id] = { name, path: dir, backend: BACKEND_IDS[1] };
    setOrder(raw, [...cur.order, id]);
  }, file);

export const removeTarget = (id: string, file?: string) =>
  editConfig((raw, cur) => {
    if (!(id in raw.targets)) throw new ConfigError(`unknown target '${id}'`);
    if (cur.order.length === 1) throw new ConfigError("cannot remove the last target");
    delete raw.targets[id];
    const order = cur.order.filter((x) => x !== id);
    setOrder(raw, order);
    if (raw.defaults?.target === id) raw.defaults = { ...raw.defaults, target: order[0] as string };
  }, file);

export const renameTarget = (id: string, name: string, file?: string) =>
  editConfig((raw) => {
    const t = raw.targets[id];
    if (!t) throw new ConfigError(`unknown target '${id}'`);
    t.name = name;
  }, file);

/** Move a target to a 1-based menu position (clamped to the list). */
export const moveTarget = (id: string, position: number, file?: string) =>
  editConfig((raw, cur) => {
    if (!cur.order.includes(id)) throw new ConfigError(`unknown target '${id}'`);
    const order = cur.order.filter((x) => x !== id);
    order.splice(Math.min(Math.max(position, 1), order.length + 1) - 1, 0, id);
    setOrder(raw, order);
  }, file);

export const setDefaults = (d: { operation?: Operation; conflict?: ConflictPolicy; target?: string }, file?: string) =>
  editConfig((raw) => {
    raw.defaults = { ...raw.defaults, ...d };
  }, file);

/** Set which operations the menus offer; the order given is the menu order. */
export const setMenuOperations = (ops: Operation[], file?: string) =>
  editConfig((raw) => {
    raw.menu = { ...raw.menu, operations: ops };
  }, file);

export const isOperation = (s: string): s is Operation => (OPERATIONS as readonly string[]).includes(s);
