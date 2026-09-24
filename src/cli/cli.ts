import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { isSea } from "node:sea";
import readline from "node:readline";
import { loadConfig, writeDefaultConfig } from "../config/config.js";
import { CONFLICT_POLICIES, OPERATIONS, type Config, type ConflictPolicy, type Operation } from "../config/types.js";
import { addTarget, isOperation, makeTargetId, moveTarget, removeTarget, renameTarget, setDefaults, setMenuOperations } from "../config/edit.js";
import { menuEntries } from "../core/menu.js";
import { adapterContext, refreshMenus } from "./menus.js";
import { runSettings } from "./settings.js";
import type { ConflictResolver } from "../core/conflicts.js";
import { ConfigError, ConflictError, EXIT, SyncDropError, ArgsError, describeError, exitCodeFor } from "../core/errors.js";
import { JsonlHistory } from "../core/history.js";
import { SyncDrop, type OperationResult } from "../core/syncdrop.js";
import { createLogger } from "../shared/logging.js";
import { desktopNotify } from "../shared/notify.js";
import { configFilePath, expandPath, historyFilePath } from "../shared/paths.js";
import { pathAdvice } from "../shared/pathhint.js";
import { getVersion } from "../shared/version.js";
import { defaultCli } from "../platforms/common.js";
import { ADAPTER_NAMES, createAdapter } from "../platforms/registry.js";

export interface CliIO {
  out(line: string): void;
  err(line: string): void;
  /** True when a person can answer prompts (TTY on stdin and stdout). */
  interactive: boolean;
  ask(question: string): Promise<string>;
  notify(title: string, body: string): void;
}

const HELP = `syncdrop - send files and folders to a sync target

Usage:
  syncdrop [--verbose] <command> [options]

Commands:
  targets, target list        List configured targets in menu order (--json for machine output)
  target add NAME --path <dir>   Add a folder to the menu   (--id <id> to choose the id)
  target remove|rename|move ...  target remove ID | target rename ID NAME | target move ID POSITION
  menu [--json]               Show the menu entries file managers display
  settings                    Change defaults, menu items and their order, and file-manager integration
  config set <key> <value>    key: operation | conflict | target | menu (e.g. menu copy,move,link)
  add FILE...                 Copy or move files/folders into a target
      -t, --target <id>         Target id (default: config defaults.target)
      -o, --operation <op>      copy | move | link     (default: config; link = shortcut to the original)
      -c, --conflict <policy>   ask | overwrite | skip | keep-both
          --notify              Show a desktop notification when done
  config path                 Print the configuration file location
  config init [--path <dir>] [--force]
                              Create a config; asks for the Syncthing folder on a terminal
  history [-n <count>] [--json]   Show recent operations
  setup [--path <dir>]        Guided first-time setup: sync folder + menu entries for every file manager found
  uninstall [--purge]         Remove the menu entries and the syncdrop program; --purge also deletes config and history
                              (your synced files are never touched)
  integrate <install|uninstall|status> [thunar|caja|dolphin|nautilus|all]
                              Manage file-manager context-menu entries

Global options:
  -h, --help       Show this help
  -V, --version    Show version
  -v, --verbose    Debug logging (stderr)

Exit codes: 0 ok, 1 operation failed, 2 invalid arguments,
            3 configuration error, 4 conflict needs a decision.
`;

interface Parsed {
  positionals: string[];
  flags: Map<string, string | true>;
}

const VALUE_OPTS: Record<string, string> = { "--target": "target", "-t": "target", "--operation": "operation", "-o": "operation", "--conflict": "conflict", "-c": "conflict", "--limit": "limit", "--path": "path", "--id": "id", "-n": "limit" };
const BOOL_OPTS: Record<string, string> = { "--help": "help", "-h": "help", "--version": "version", "-V": "version", "--verbose": "verbose", "-v": "verbose", "--json": "json", "--notify": "notify", "--force": "force", "--purge": "purge" };

export function parseArgs(argv: string[]): Parsed {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq > 0 && arg.startsWith("--") ? arg.slice(0, eq) : arg;
    if (name in BOOL_OPTS) {
      flags.set(BOOL_OPTS[name] as string, true);
    } else if (name in VALUE_OPTS) {
      const value = eq > 0 && arg.startsWith("--") ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined) throw new ArgsError(`option ${name} needs a value`);
      flags.set(VALUE_OPTS[name] as string, value);
    } else {
      throw new ArgsError(`unknown option '${arg}'`);
    }
  }
  return { positionals, flags };
}

function makeResolver(io: CliIO): ConflictResolver {
  return async ({ destination }) => {
    for (;;) {
      const answer = (
        await io.ask(`'${destination}' already exists. [o]verwrite, [s]kip, [k]eep both, [a]bort (capital = apply to all): `)
      ).trim();
      switch (answer) {
        case "o": return { policy: "overwrite" };
        case "O": return { policy: "overwrite", applyToAll: true };
        case "s": return { policy: "skip" };
        case "S": return { policy: "skip", applyToAll: true };
        case "k": return { policy: "keep-both" };
        case "K": return { policy: "keep-both", applyToAll: true };
        case "a": case "A": case "":
          throw new ConflictError("aborted by user");
      }
    }
  };
}

function describeResult(r: OperationResult): string {
  const verb = r.operation === "move" ? "moved" : r.operation === "link" ? "linked" : "copied";
  if (!r.success) return `FAILED   ${r.source}: ${r.error}`;
  if (r.skipped) return `skipped  ${r.source} (already exists)`;
  const extra = r.skippedItems ? ` (${r.skippedItems} existing item(s) skipped)` : "";
  return `${verb}   ${r.source} -> ${r.destination}${extra}`;
}

async function cmdAdd(p: Parsed, io: CliIO, logger: ReturnType<typeof createLogger>): Promise<number> {
  const config = await loadConfig();
  const targetId = (p.flags.get("target") as string | undefined) ?? config.defaults.target;
  const operation = (p.flags.get("operation") as string | undefined) ?? config.defaults.operation;
  const conflict = (p.flags.get("conflict") as string | undefined) ?? config.defaults.conflict;
  if (!OPERATIONS.includes(operation as Operation)) throw new ArgsError(`--operation must be one of: ${OPERATIONS.join(", ")}`);
  if (!CONFLICT_POLICIES.includes(conflict as ConflictPolicy)) throw new ArgsError(`--conflict must be one of: ${CONFLICT_POLICIES.join(", ")}`);
  const sources = p.positionals.slice(1);
  if (sources.length === 0) throw new ArgsError("add: no files or folders given");

  const sd = new SyncDrop({
    config,
    logger,
    history: new JsonlHistory(historyFilePath()),
    resolver: io.interactive ? makeResolver(io) : undefined,
  });
  const notify = p.flags.has("notify");
  let results: OperationResult[];
  try {
    results = await sd.add({ sources, targetId, operation: operation as Operation, conflict: conflict as ConflictPolicy });
  } catch (e) {
    if (notify) io.notify("SyncDrop failed", describeError(e));
    throw e;
  }

  for (const r of results) (r.success ? io.out : io.err)(describeResult(r));
  const failed = results.filter((r) => !r.success);
  if (notify) {
    const target = config.targets[targetId]?.name ?? targetId;
    io.notify(
      failed.length ? "SyncDrop: some items failed" : "SyncDrop",
      failed.length ? failed.map((r) => r.error).join("\n") : `${results.length} item(s) sent to ${target}`,
    );
  }
  if (failed.length === 0) return EXIT.OK;
  return failed.some((r) => r.errorCode !== "CONFLICT") ? EXIT.FAILURE : EXIT.CONFLICT;
}

async function cmdTargets(p: Parsed, io: CliIO): Promise<number> {
  const config = await loadConfig();
  const rows = await Promise.all(
    config.order.map((id) => config.targets[id] as Config["targets"][string]).map(async (t) => ({
      id: t.id,
      name: t.name,
      backend: t.backend,
      path: t.path,
      exists: await stat(t.path).then((s) => s.isDirectory(), () => false),
    })),
  );
  if (p.flags.has("json")) {
    io.out(JSON.stringify(rows, null, 2));
    return EXIT.OK;
  }
  const w = (k: "id" | "name" | "backend") => Math.max(k.length, ...rows.map((r) => r[k].length));
  const [wi, wn, wb] = [w("id"), w("name"), w("backend")];
  io.out(`${"ID".padEnd(wi)}  ${"NAME".padEnd(wn)}  ${"BACKEND".padEnd(wb)}  PATH`);
  for (const r of rows) {
    io.out(`${r.id.padEnd(wi)}  ${r.name.padEnd(wn)}  ${r.backend.padEnd(wb)}  ${r.path}${r.exists ? "" : "  (missing)"}`);
  }
  return EXIT.OK;
}

const MAX_EXTRA_FOLDERS = 9;

async function cmdConfig(p: Parsed, io: CliIO): Promise<number> {
  const sub = p.positionals[1];
  if (sub === "path") {
    io.out(configFilePath());
    return EXIT.OK;
  }
  if (sub === "init") {
    const file = configFilePath();
    let folder = p.flags.get("path");
    if (folder === true) throw new ArgsError("--path needs a folder");
    if (!folder && io.interactive) {
      // Fail before prompting if the config exists and would not be overwritten.
      if (!p.flags.has("force") && (await stat(file).then(() => true, () => false))) {
        throw new ConfigError(`${file} already exists (use --force to overwrite)`);
      }
      io.out("SyncDrop copies files into a folder that Syncthing already syncs.");
      folder = (await io.ask("Path of that Syncthing folder [~/SyncDrop]: ")).trim() || "~/SyncDrop";
    }
    // Validate (and offer to create) a folder; returns true if it was created.
    const prepare = async (raw: string): Promise<boolean> => {
      const dir = expandPath(raw);
      if (!path.isAbsolute(dir)) throw new ArgsError(`path must be absolute or start with ~ (got '${raw}')`);
      const info = await stat(dir).catch(() => undefined);
      if (info && !info.isDirectory()) throw new ArgsError(`${dir} exists but is not a folder`);
      if (info) return false;
      const yes = io.interactive ? /^y/i.test((await io.ask(`${dir} does not exist. Create it? [Y/n]: `)).trim() || "y") : false;
      if (yes) {
        await mkdir(dir, { recursive: true });
        return true;
      }
      io.err(`warning: ${dir} does not exist yet; create it before using SyncDrop`);
      return false;
    };
    let created = false;
    if (folder) created = await prepare(folder);
    let mainName = "Main Sync";
    const extras: Record<string, { name: string; path: string }> = {};
    if (folder && io.interactive && !p.flags.has("path")) {
      io.out("This name is what you will see in the right-click menu.");
      mainName = path.basename(expandPath(folder)) || mainName;
      mainName = (await io.ask(`Name for this folder, or Enter for default [${mainName}]: `)).trim() || mainName;
      const used = new Set<string>(["main"]);
      let more = /^y/i.test((await io.ask("Add more folders to SyncDrop? [y/N]: ")).trim());
      while (more) {
        let raw = "";
        while (!raw) raw = (await io.ask("  Path of the folder: ")).trim();
        const name = (await io.ask(`  Name for this folder, or Enter for default [${path.basename(expandPath(raw)) || "Folder"}]: `)).trim() || path.basename(expandPath(raw)) || "Folder";
        await prepare(raw);
        const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "folder";
        let id = base;
        for (let k = 2; used.has(id); k++) id = `${base}-${k}`;
        used.add(id);
        extras[id] = { name, path: raw };
        if (Object.keys(extras).length >= MAX_EXTRA_FOLDERS) {
          io.out(`That is the maximum of ${MAX_EXTRA_FOLDERS + 1} folders. To add more, edit the SyncDrop config file: ${file}`);
          break;
        }
        more = /^y/i.test((await io.ask("Add more folders to SyncDrop? [y/N]: ")).trim());
      }
    }
    await writeDefaultConfig(file, p.flags.has("force"), folder || undefined, mainName, extras);
    io.out(`created ${file}`);
    if (folder) {
      io.out(`target 'main' ("${mainName}") -> ${folder}${created ? " (folder created)" : ""}`);
      for (const [id, t] of Object.entries(extras)) io.out(`target '${id}' ("${t.name}") -> ${t.path}`);
      io.out("Make sure Syncthing shares this folder. Check with: syncdrop targets");
    } else {
      io.out("Edit the target paths so they match folders Syncthing syncs, then run: syncdrop targets");
    }
    return EXIT.OK;
  }
  if (sub === "set") return await cmdConfigSet(p, io);
  throw new ArgsError("config: expected 'path', 'init' or 'set'");
}

async function cmdHistory(p: Parsed, io: CliIO): Promise<number> {
  const limit = Number(p.flags.get("limit") ?? 20);
  if (!Number.isInteger(limit) || limit < 1) throw new ArgsError("--limit must be a positive integer");
  const entries = await new JsonlHistory(historyFilePath()).recent(limit);
  if (p.flags.has("json")) {
    io.out(JSON.stringify(entries, null, 2));
    return EXIT.OK;
  }
  if (entries.length === 0) io.out("no history yet");
  for (const e of entries) {
    const state = e.success ? (e.skipped ? "SKIP" : "OK  ") : "FAIL";
    io.out(`${e.timestamp}  ${state}  ${e.operation}  ${e.target}  ${e.source}${e.destination ? " -> " + e.destination : ""}${e.error ? "  (" + e.error + ")" : ""}`);
  }
  return EXIT.OK;
}

async function cmdMenu(p: Parsed, io: CliIO): Promise<number> {
  const entries = menuEntries(await loadConfig());
  if (p.flags.has("json")) io.out(JSON.stringify(entries, null, 2));
  else entries.forEach((e) => io.out(e.label));
  return EXIT.OK;
}

async function cmdTargetEdit(p: Parsed, io: CliIO): Promise<number> {
  const [, sub, a, b] = p.positionals;
  const config = await loadConfig();
  let updated: Config;
  if (sub === "add") {
    const name = a;
    const dir = p.flags.get("path");
    if (!name || typeof dir !== "string") throw new ArgsError("target add: usage: target add NAME --path <folder> [--id <id>]");
    if (!path.isAbsolute(expandPath(dir))) throw new ArgsError(`path must be absolute or start with ~ (got '${dir}')`);
    const id = typeof p.flags.get("id") === "string" ? (p.flags.get("id") as string) : makeTargetId(name, Object.keys(config.targets));
    updated = await addTarget(id, name, dir);
    io.out(`added '${id}' ("${name}") -> ${dir}`);
  } else if (sub === "remove" && a) {
    updated = await removeTarget(a);
    io.out(`removed '${a}' (the folder itself was not touched)`);
  } else if (sub === "rename" && a && b) {
    updated = await renameTarget(a, b);
    io.out(`renamed '${a}' to "${b}"`);
  } else if (sub === "move" && a && b) {
    const pos = Number(b);
    if (!Number.isInteger(pos) || pos < 1) throw new ArgsError("target move: POSITION must be 1 or more");
    updated = await moveTarget(a, pos);
    io.out(`menu order: ${updated.order.join(", ")}`);
  } else {
    throw new ArgsError("target: expected list, add, remove, rename or move");
  }
  await refreshMenus(updated, io);
  return EXIT.OK;
}

async function cmdConfigSet(p: Parsed, io: CliIO): Promise<number> {
  const [, , key, value] = p.positionals;
  if (!key || !value) throw new ArgsError("config set: usage: config set <operation|conflict|target|menu> <value>");
  let updated: Config;
  if (key === "operation") {
    if (!isOperation(value)) throw new ArgsError(`operation must be one of: ${OPERATIONS.join(", ")}`);
    updated = await setDefaults({ operation: value });
  } else if (key === "conflict") {
    if (!CONFLICT_POLICIES.includes(value as ConflictPolicy)) throw new ArgsError(`conflict must be one of: ${CONFLICT_POLICIES.join(", ")}`);
    updated = await setDefaults({ conflict: value as ConflictPolicy });
  } else if (key === "target") {
    updated = await setDefaults({ target: value });
  } else if (key === "menu") {
    const ops = value.split(",").map((s) => s.trim());
    if (!ops.every(isOperation)) throw new ArgsError(`menu: use a comma-separated list of: ${OPERATIONS.join(", ")}`);
    updated = await setMenuOperations(ops);
  } else {
    throw new ArgsError(`config set: unknown key '${key}'`);
  }
  io.out(`${key} = ${value}`);
  await refreshMenus(updated, io);
  return EXIT.OK;
}

async function cmdIntegrate(p: Parsed, io: CliIO): Promise<number> {
  const action = p.positionals[1];
  const which = p.positionals[2] ?? "all";
  if (action !== "install" && action !== "uninstall" && action !== "status") {
    throw new ArgsError("integrate: expected install, uninstall or status");
  }
  // Removing entries must work even after the config was deleted.
  const ctx = action === "install" ? adapterContext(await loadConfig()) : { cli: defaultCli(), targets: [] };
  const names = which === "all" ? [...ADAPTER_NAMES] : [which];
  let code: number = EXIT.OK;
  for (const name of names) {
    const adapter = createAdapter(name, ctx);
    const supported = await adapter.isSupported();
    if (action === "status") {
      io.out(`${name}: ${supported ? "file manager found" : "file manager not found"}`);
      continue;
    }
    if (!supported && which === "all") {
      io.out(`${name}: not installed, skipping`);
      continue;
    }
    if (!supported) io.err(`${name}: warning: file manager not found on PATH, installing anyway`);
    try {
      const report = action === "install" ? await adapter.install() : await adapter.uninstall();
      io.out(`${name}: ${action === "install" ? "installed" : "removed"} ${report.files.join(", ")}`);
      report.notes.forEach((n) => io.out(`  ${n}`));
    } catch (e) {
      io.err(`${name}: ${describeError(e)}`);
      code = EXIT.FAILURE; // one adapter failing must not stop the others
    }
  }
  return code;
}

const execP = promisify(execFile);

// Names of the given file managers that are currently running.
async function runningManagers(names: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const n of names) if (await execP("pgrep", ["-x", n]).then(() => true, () => false)) found.push(n);
  return found;
}

async function offerRestart(names: string[], io: CliIO): Promise<void> {
  const running = await runningManagers(names);
  if (running.length === 0) return;
  io.out(`Running now: ${running.join(", ")}. Windows open in them will close.`);
  const a = (await io.ask("[R]estart them for me, [Q]uit them and I'll reopen them myself, or Enter to do nothing: ")).trim().toLowerCase();
  if (a !== "r" && a !== "q") return;
  for (const n of running) {
    await execP("pkill", ["-x", n]).catch(() => undefined);
    if (a === "r") {
      // Give the old process a moment to exit, then start a detached copy.
      await new Promise((r) => setTimeout(r, 800));
      spawn(n, [], { detached: true, stdio: "ignore" }).on("error", () => io.err(`could not start ${n}; open it yourself`)).unref();
    }
  }
  io.out(a === "r" ? "Restarted." : "Closed. Open your file manager again when you are ready.");
}

async function cmdSetup(p: Parsed, io: CliIO): Promise<number> {
  const file = configFilePath();
  io.out("SyncDrop setup");
  if (await stat(file).then(() => true, () => false)) {
    io.out(`Keeping your existing settings (${file}).`);
  } else {
    const code = await cmdConfig({ positionals: ["config", "init"], flags: p.flags }, io);
    if (code !== EXIT.OK) return code;
  }
  io.out("");
  const config = await loadConfig();
  const ctx = adapterContext(config);
  let installed = 0;
  const installedNames: string[] = [];
  let code: number = EXIT.OK;
  for (const name of ADAPTER_NAMES) {
    const adapter = createAdapter(name, ctx);
    if (!(await adapter.isSupported())) continue;
    try {
      const report = await adapter.install();
      installed++;
      installedNames.push(name);
      io.out(`Added the SyncDrop menu to ${name}.`);
      report.notes.forEach((n) => io.out(`  ${n}`));
    } catch (e) {
      io.err(`${name}: ${describeError(e)}`);
      code = EXIT.FAILURE;
    }
  }
  if (installed === 0 && code === EXIT.OK) {
    io.out("No supported file manager found (Thunar, Caja, Dolphin, Nautilus). The command line still works: syncdrop add FILE...");
  } else if (installed > 0) {
    io.out("");
    io.out("Almost done: restart your file manager (or log out and back in), then right-click a file and choose SyncDrop.");
    if (io.interactive) await offerRestart(installedNames, io);
  }
  if (isSea()) {
    const dir = path.dirname(process.execPath);
    if (!(process.env.PATH ?? "").split(path.delimiter).includes(dir)) {
      const red = io.interactive && !process.env.NO_COLOR;
      io.out("");
      pathAdvice(dir).forEach((line, i) => io.out(red && i === 0 ? `\x1b[31;1mWARNING: ${line}\x1b[0m` : i === 0 ? `WARNING: ${line}` : line));
    }
  }
  return code;
}

async function cmdUninstall(p: Parsed, io: CliIO): Promise<number> {
  let code: number = EXIT.OK;
  // Menu entries first: they are removed by this binary. Config is not needed, so a broken one can't block this.
  for (const name of ADAPTER_NAMES) {
    try {
      const report = await createAdapter(name, { cli: defaultCli(), targets: [] }).uninstall();
      if (report.files.length > 0) io.out(`Removed the SyncDrop menu from ${name}.`);
    } catch (e) {
      io.err(`${name}: ${describeError(e)}`);
      code = EXIT.FAILURE; // one adapter failing must not stop the others
    }
  }
  if (isSea()) {
    try {
      await rm(process.execPath, { force: true });
      io.out(`Removed ${process.execPath}`);
    } catch (e) {
      io.err(`could not remove ${process.execPath}: ${describeError(e)}`);
      code = EXIT.FAILURE;
    }
  } else {
    io.out("Not running the installed program, so nothing to delete there (remove it with your package manager or by hand).");
  }
  if (p.flags.has("purge")) {
    for (const file of [configFilePath(), historyFilePath()]) {
      try {
        await rm(file, { force: true });
        io.out(`Removed ${file}`);
        await rmdir(path.dirname(file)).catch(() => undefined); // only if now empty
      } catch (e) {
        io.err(`could not remove ${file}: ${describeError(e)}`);
        code = EXIT.FAILURE;
      }
    }
  } else {
    io.out(`Kept your settings and history (add --purge to delete them): ${configFilePath()}`);
  }
  io.out("Restart your file manager (or log out and back in) so the menu entries disappear. Synced files were not touched.");
  return code;
}

/** Run the CLI and return the process exit code. */
export async function run(argv: string[], io: CliIO): Promise<number> {
  try {
    const p = parseArgs(argv);
    if (p.flags.has("version")) {
      io.out(getVersion());
      return EXIT.OK;
    }
    const command = p.positionals[0];
    if (p.flags.has("help") || !command || command === "help") {
      io.out(HELP);
      return EXIT.OK;
    }
    const logger = createLogger(p.flags.has("verbose") ? "debug" : "warn", (l) => io.err(l));
    switch (command) {
      case "add":
        return await cmdAdd(p, io, logger);
      case "targets":
        return await cmdTargets(p, io);
      case "target":
        if (p.positionals[1] === "list") return await cmdTargets(p, io);
        return await cmdTargetEdit(p, io);
      case "menu":
        return await cmdMenu(p, io);
      case "settings":
        return await runSettings(io);
      case "config":
        return await cmdConfig(p, io);
      case "history":
        return await cmdHistory(p, io);
      case "setup":
        return await cmdSetup(p, io);
      case "uninstall":
        return await cmdUninstall(p, io);
      case "integrate":
        return await cmdIntegrate(p, io);
      default:
        throw new ArgsError(`unknown command '${command}'. Try 'syncdrop --help'.`);
    }
  } catch (e) {
    io.err(`syncdrop: ${describeError(e)}`);
    return e instanceof SyncDropError ? exitCodeFor(e.code) : EXIT.FAILURE;
  }
}

export function createProcessIO(): CliIO {
  return {
    out: (l) => void process.stdout.write(l + "\n"),
    err: (l) => void process.stderr.write(l + "\n"),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask: (q) =>
      new Promise<string>((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
        rl.once("close", () => resolve(""));
        rl.question(q, (a) => {
          resolve(a);
          rl.close();
        });
      }),
    notify: desktopNotify,
  };
}
