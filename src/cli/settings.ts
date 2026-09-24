import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/config.js";
import { addTarget, isOperation, makeTargetId, moveTarget, removeTarget, renameTarget, setDefaults, setMenuOperations } from "../config/edit.js";
import { CONFLICT_POLICIES, OPERATIONS, type Config, type ConflictPolicy, type Operation } from "../config/types.js";
import { ArgsError, EXIT, describeError } from "../core/errors.js";
import { menuEntries } from "../core/menu.js";
import { ADAPTER_NAMES, createAdapter } from "../platforms/registry.js";
import { expandPath } from "../shared/paths.js";
import type { CliIO } from "./cli.js";
import { adapterContext, refreshMenus } from "./menus.js";

/** Ask for a number 1..max. Returns null on Enter/EOF/anything else (meaning "back"). */
async function askNumber(io: CliIO, question: string, max: number): Promise<number | null> {
  const n = Number((await io.ask(question)).trim());
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

const listTargets = (io: CliIO, c: Config) =>
  c.order.forEach((id, i) => io.out(`  ${i + 1}) ${(c.targets[id] as { name: string }).name}  [${id}]  ${(c.targets[id] as { path: string }).path}`));

async function chooseFrom<T extends string>(io: CliIO, title: string, options: readonly T[]): Promise<T | null> {
  io.out(title);
  options.forEach((o, i) => io.out(`  ${i + 1}) ${o}`));
  const n = await askNumber(io, "Number (Enter to go back): ", options.length);
  return n === null ? null : (options[n - 1] as T);
}

async function defaultsMenu(io: CliIO, c: Config): Promise<Config> {
  io.out(`\nDefaults: operation=${c.defaults.operation}, conflict=${c.defaults.conflict}, target=${c.defaults.target}`);
  const what = await chooseFrom(io, "Change which default?", ["operation", "conflict", "target"] as const);
  if (what === "operation") {
    const v = await chooseFrom(io, "Default operation (used by 'syncdrop add' when none is given):", OPERATIONS);
    return v ? setDefaults({ operation: v }) : c;
  }
  if (what === "conflict") {
    const v = await chooseFrom(io, "When a file already exists:", CONFLICT_POLICIES);
    return v ? setDefaults({ conflict: v as ConflictPolicy }) : c;
  }
  if (what === "target") {
    const v = await chooseFrom(io, "Default folder:", c.order);
    return v ? setDefaults({ target: v }) : c;
  }
  return c;
}

async function menuMenu(io: CliIO, c: Config): Promise<Config> {
  io.out("\nWhat the right-click menu shows, in order:");
  menuEntries(c).forEach((e, i) => io.out(`  ${i + 1}. ${e.label}`));
  io.out("  then: Settings");
  const what = await chooseFrom(io, "Change:", ["Which actions to offer (copy / move / link) and their order", "Order of the folders"] as const);
  if (what?.startsWith("Which")) {
    const raw = (await io.ask(`Actions in the order you want, comma separated, from ${OPERATIONS.join(", ")} [${c.menu.operations.join(",")}]: `)).trim();
    if (!raw) return c;
    const ops = raw.split(/[\s,]+/).filter(Boolean);
    if (!ops.every(isOperation) || new Set(ops).size !== ops.length) {
      io.err(`Use only ${OPERATIONS.join(", ")}, each once.`);
      return c;
    }
    return setMenuOperations(ops as Operation[]);
  }
  if (what) return moveFolder(io, c);
  return c;
}

async function moveFolder(io: CliIO, c: Config): Promise<Config> {
  listTargets(io, c);
  const from = await askNumber(io, "Move which folder (number)? ", c.order.length);
  if (from === null) return c;
  const to = await askNumber(io, `New position (1-${c.order.length})? `, c.order.length);
  return to === null ? c : moveTarget(c.order[from - 1] as string, to);
}

async function foldersMenu(io: CliIO, c: Config): Promise<Config> {
  io.out("\nFolders in the menu:");
  listTargets(io, c);
  const what = await chooseFrom(io, "Do what?", ["Add a folder", "Remove a folder", "Rename a folder", "Change order"] as const);
  if (what === "Add a folder") {
    const raw = (await io.ask("  Path of the folder (a folder Syncthing syncs): ")).trim();
    if (!raw) return c;
    const dir = expandPath(raw);
    if (!path.isAbsolute(dir)) {
      io.err("The path must be absolute or start with ~");
      return c;
    }
    const info = await stat(dir).catch(() => undefined);
    if (info && !info.isDirectory()) {
      io.err(`${dir} exists but is not a folder`);
      return c;
    }
    const fallback = path.basename(dir) || "Folder";
    const name = (await io.ask(`  Name shown in the menu [${fallback}]: `)).trim() || fallback;
    if (!info && /^y/i.test((await io.ask(`  ${dir} does not exist. Create it? [Y/n]: `)).trim() || "y")) await mkdir(dir, { recursive: true });
    return addTarget(makeTargetId(name, c.order), name, raw);
  }
  if (what === "Remove a folder") {
    const n = await askNumber(io, "Remove which folder (number)? The folder on disk is not touched: ", c.order.length);
    return n === null ? c : removeTarget(c.order[n - 1] as string);
  }
  if (what === "Rename a folder") {
    const n = await askNumber(io, "Rename which folder (number)? ", c.order.length);
    if (n === null) return c;
    const name = (await io.ask("  New name: ")).trim();
    return name ? renameTarget(c.order[n - 1] as string, name) : c;
  }
  if (what) return moveFolder(io, c);
  return c;
}

async function managersMenu(io: CliIO, c: Config): Promise<void> {
  const rows = await Promise.all(
    ADAPTER_NAMES.map(async (name) => {
      const a = createAdapter(name, adapterContext(c));
      return { name, a, found: await a.isSupported(), installed: await a.isInstalled() };
    }),
  );
  io.out("\nFile managers:");
  rows.forEach((r, i) => io.out(`  ${i + 1}) ${r.name}: ${r.found ? "found" : "not found"}, SyncDrop menu ${r.installed ? "installed" : "not installed"}`));
  const n = await askNumber(io, "Number to add or remove its SyncDrop menu (Enter to go back): ", rows.length);
  if (n === null) return;
  const r = rows[n - 1] as (typeof rows)[number];
  const report = r.installed ? await r.a.uninstall() : await r.a.install();
  io.out(`${r.name}: SyncDrop menu ${r.installed ? "removed" : "installed"}.`);
  report.notes.forEach((note) => io.out(`  ${note}`));
}

/** Interactive settings screen. Every change is saved at once; menus that are already installed are refreshed. */
export async function runSettings(io: CliIO): Promise<number> {
  if (!io.interactive) throw new ArgsError("settings needs a terminal. Use 'syncdrop config set' and 'syncdrop target' in scripts.");
  let config = await loadConfig();
  for (;;) {
    io.out("\nSyncDrop settings");
    const what = await chooseFrom(io, "", ["Defaults", "Menu items and their order", "Folders (add / remove / rename)", "File managers (install / remove menu)"] as const);
    if (!what) return EXIT.OK;
    try {
      if (what === "File managers (install / remove menu)") {
        await managersMenu(io, config);
        continue;
      }
      const next = await (what === "Defaults" ? defaultsMenu : what.startsWith("Menu") ? menuMenu : foldersMenu)(io, config);
      if (next !== config) {
        config = next;
        io.out("Saved.");
        await refreshMenus(config, io);
      }
    } catch (e) {
      io.err(`could not do that: ${describeError(e)}`);
      config = await loadConfig();
    }
  }
}
