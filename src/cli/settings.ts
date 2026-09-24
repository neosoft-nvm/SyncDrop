import { loadConfig } from "../config/config.js";
import { addTarget, makeTargetId, moveTarget, removeTarget, renameTarget, setDefaults, setMenuOptions, type MenuFlags } from "../config/edit.js";
import { CONFLICT_POLICIES, OPERATIONS, type Config, type Operation } from "../config/types.js";
import { ArgsError, EXIT, describeError } from "../core/errors.js";
import { ADAPTER_NAMES, createAdapter } from "../platforms/registry.js";
import type { CliIO } from "./cli.js";
import { askFolderName, askFolderPath, type KnownFolder } from "./folder-input.js";
import { adapterContext, refreshMenus } from "./menus.js";
import { heading, isYes } from "./ui.js";

const MAX_TRIES = 10;
const CONFLICT_HELP: Record<string, string> = {
  ask: "ask me each time",
  overwrite: "replace the existing file",
  skip: "leave the existing file alone",
  "keep-both": "keep both (adds a number to the new name)",
};
const OP_NAME: Record<Operation, string> = { copy: "Copy", move: "Move", link: "Link (shortcut)" };

interface Choice {
  label: string;
}

/** Show numbered choices plus "0) <zero>" and return the 0-based index, or null for 0, Enter or end of input. */
async function menu(io: CliIO, choices: Choice[], zero: string, question = "Choose a number"): Promise<number | null> {
  choices.forEach((c, i) => io.out(`  ${i + 1}) ${c.label}`));
  io.out(`  0) ${zero}`);
  for (let i = 0; i < MAX_TRIES; i++) {
    const a = (await io.ask(`${question}: `)).trim();
    if (a === "" || a === "0") return null;
    const n = Number(a);
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) return n - 1;
    io.err(`Please type one of the numbers shown (0 to go back).`);
  }
  return null;
}

const nameOf = (c: Config, id: string) => (c.targets[id] as { name: string }).name;
const known = (c: Config, except?: string): KnownFolder[] =>
  c.order.filter((id) => id !== except).map((id) => ({ name: nameOf(c, id), path: (c.targets[id] as { path: string }).path }));

function showFolders(io: CliIO, c: Config, withPaths: boolean): void {
  c.order.forEach((id, i) => io.out(`  ${i + 1}. ${nameOf(c, id)}${withPaths ? `   (${(c.targets[id] as { path: string }).path})` : ""}`));
}

/** Ask which folder, by number or by name. Returns its id, or null to cancel. */
async function pickFolder(io: CliIO, c: Config, what: string): Promise<string | null> {
  showFolders(io, c, true);
  io.out("");
  for (let i = 0; i < MAX_TRIES; i++) {
    const a = (await io.ask(`Which folder do you want to ${what}? Type its number or name (Enter to cancel): `)).trim();
    if (!a) return null;
    const n = Number(a);
    if (Number.isInteger(n) && n >= 1 && n <= c.order.length) return c.order[n - 1] as string;
    const lower = a.toLowerCase();
    const exact = c.order.filter((id) => nameOf(c, id).toLowerCase() === lower || id.toLowerCase() === lower);
    const part = c.order.filter((id) => nameOf(c, id).toLowerCase().startsWith(lower));
    const hit = exact.length === 1 ? exact : part.length === 1 ? part : [];
    if (hit.length === 1) return hit[0] as string;
    io.err(exact.length > 1 || part.length > 1 ? `More than one folder matches '${a}'; type its number.` : `No folder matches '${a}'.`);
  }
  return null;
}

type State = { config: Config };

/** Run a change, save the result, refresh installed menus. Errors are shown, never fatal. */
async function apply(io: CliIO, st: State, change: () => Promise<Config>, done: string): Promise<boolean> {
  try {
    st.config = await change();
    io.out(done);
    await refreshMenus(st.config, io);
    return true;
  } catch (e) {
    io.err(`Could not do that: ${describeError(e)}`);
    st.config = await loadConfig();
    return false;
  }
}

async function defaultsScreen(io: CliIO, st: State): Promise<void> {
  for (;;) {
    const d = st.config.defaults;
    heading(io, "Defaults");
    io.out(`  Action used when none is given (command line): ${OP_NAME[d.operation]}`);
    io.out(`  When a file already exists:                     ${CONFLICT_HELP[d.conflict]}`);
    io.out(`  Default folder:                                 ${nameOf(st.config, d.target)}`);
    io.out("");
    const pick = await menu(io, [{ label: "Change the default action" }, { label: "Change what happens when a file already exists" }, { label: "Change the default folder" }], "Back");
    if (pick === null) return;
    io.out("");
    if (pick === 0) {
      const v = await menu(io, OPERATIONS.map((o) => ({ label: `${OP_NAME[o]}${o === d.operation ? "  (current)" : ""}` })), "Cancel");
      if (v !== null) await apply(io, st, () => setDefaults({ operation: OPERATIONS[v] as Operation }), "Saved.");
    } else if (pick === 1) {
      const v = await menu(io, CONFLICT_POLICIES.map((o) => ({ label: `${CONFLICT_HELP[o]}${o === d.conflict ? "  (current)" : ""}` })), "Cancel");
      if (v !== null) await apply(io, st, () => setDefaults({ conflict: CONFLICT_POLICIES[v] as never }), "Saved.");
    } else {
      const v = await menu(io, st.config.order.map((id) => ({ label: `${nameOf(st.config, id)}${id === d.target ? "  (current)" : ""}` })), "Cancel");
      if (v !== null) await apply(io, st, () => setDefaults({ target: st.config.order[v] as string }), "Saved.");
    }
  }
}

async function orderScreen(io: CliIO, st: State): Promise<void> {
  for (;;) {
    heading(io, "Menu order");
    io.out("Folders appear in this order in the right-click menu:");
    showFolders(io, st.config, false);
    io.out("");
    const pick = await menu(io, [{ label: "Change the order of the folders" }], "Back");
    if (pick === null) return;
    await reorder(io, st);
  }
}

const yn = (b: boolean) => (b ? "yes" : "no");

async function keysScreen(io: CliIO, st: State): Promise<void> {
  for (;;) {
    const m = st.config.menu;
    heading(io, "Modifier keys");
    io.out("Hold a key while you click a folder in the SyncDrop menu to change what happens.");
    io.out("Without a key, files are copied. (If both keys are held, a link is made.)");
    io.out("Nautilus and Caja can see held keys. Thunar and Dolphin cannot.");
    io.out("");
    const keys: { label: string; flag: keyof MenuFlags }[] = [
      { label: `Hold Ctrl to MOVE instead of copy:                  ${yn(m.ctrlMove)}`, flag: "ctrlMove" },
      { label: `Hold Shift to make a LINK (shortcut) instead:       ${yn(m.shiftLink)}`, flag: "shiftLink" },
      { label: `Thunar and Dolphin: list Move / Link entries too:   ${yn(m.explicitEntries)}`, flag: "explicitEntries" },
    ];
    const pick = await menu(io, keys, "Back", "Type a number to switch it yes/no");
    if (pick === null) return;
    const flag = (keys[pick] as (typeof keys)[number]).flag;
    await apply(io, st, () => setMenuOptions({ [flag]: !m[flag] }), "Saved.");
  }
}

async function reorder(io: CliIO, st: State): Promise<void> {
  if (st.config.order.length < 2) {
    io.out("There is only one folder, so there is nothing to reorder.");
    return;
  }
  heading(io, "Change the order of the folders");
  const id = await pickFolder(io, st.config, "move");
  if (!id) return;
  const at = st.config.order.indexOf(id) + 1;
  const to = Number((await io.ask(`Move "${nameOf(st.config, id)}" to which position (1-${st.config.order.length}, now ${at})? `)).trim());
  if (!Number.isInteger(to) || to < 1 || to > st.config.order.length) {
    io.err(`Please type a number from 1 to ${st.config.order.length}.`);
    return;
  }
  if (await apply(io, st, () => moveTarget(id, to), "Saved. New order:")) showFolders(io, st.config, false);
}

async function foldersScreen(io: CliIO, st: State): Promise<void> {
  for (;;) {
    const c = st.config;
    heading(io, "Folders");
    io.out("Your folders:");
    showFolders(io, c, true);
    io.out("");
    const pick = await menu(io, [{ label: "Add a folder" }, { label: "Remove a folder" }, { label: "Rename a folder" }, { label: "Change the order" }], "Back");
    if (pick === null) return;
    if (pick === 0) {
      heading(io, "Add a folder");
      const added = await askFolderPath(io, "Path of the folder (Enter to cancel): ", known(c)).catch((e) => (io.err(describeError(e)), null));
      if (!added) continue;
      const fb = added.raw.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || "Folder";
      const name = await askFolderName(io, `Name shown in the menu [${fb}]: `, fb, known(c));
      if (!name) continue;
      await apply(io, st, () => addTarget(makeTargetId(name, c.order), name, added.raw), `Added "${name}" as number ${c.order.length + 1}. Use "Change the order" to move it.`);
    } else if (pick === 1) {
      heading(io, "Remove a folder");
      if (c.order.length === 1) {
        io.out("This is your only folder, so it can't be removed. Add another one first.");
        continue;
      }
      const id = await pickFolder(io, c, "remove");
      if (!id) continue;
      io.out(`This only takes "${nameOf(c, id)}" out of the SyncDrop menu. The folder and its files are not touched.`);
      if (isYes(await io.ask(`Remove "${nameOf(c, id)}" from the menu? [y/N]: `))) await apply(io, st, () => removeTarget(id), "Removed.");
    } else if (pick === 2) {
      heading(io, "Rename a folder");
      const id = await pickFolder(io, c, "rename");
      if (!id) continue;
      const name = await askFolderName(io, `New name for "${nameOf(c, id)}" (Enter to cancel): `, "", known(c, id));
      if (name) await apply(io, st, () => renameTarget(id, name), "Saved.");
    } else {
      await reorder(io, st);
    }
  }
}

async function managersScreen(io: CliIO, st: State): Promise<void> {
  for (;;) {
    const rows = await Promise.all(
      ADAPTER_NAMES.map(async (name) => {
        const a = createAdapter(name, adapterContext(st.config));
        return { name, a, found: await a.isSupported(), installed: await a.isInstalled() };
      }),
    );
    heading(io, "File managers");
    io.out("Pick one to add or remove its SyncDrop menu.");
    io.out("");
    const pick = await menu(
      io,
      rows.map((r) => ({ label: `${r.name}: ${r.found ? "" : "not found on this computer, "}menu ${r.installed ? "installed" : "not installed"}` })),
      "Back",
    );
    if (pick === null) return;
    const r = rows[pick] as (typeof rows)[number];
    try {
      const report = r.installed ? await r.a.uninstall() : await r.a.install();
      io.out(`${r.name}: SyncDrop menu ${r.installed ? "removed" : "installed"}.`);
      report.notes.forEach((note) => io.out(`  ${note}`));
    } catch (e) {
      io.err(`${r.name}: ${describeError(e)}`);
    }
  }
}

/** Interactive settings screen. Every change is saved at once; menus that are already installed are refreshed. */
export async function runSettings(io: CliIO): Promise<number> {
  if (!io.interactive) throw new ArgsError("settings needs a terminal. Use 'syncdrop config set' and 'syncdrop target' in scripts.");
  const st: State = { config: await loadConfig() };
  for (;;) {
    heading(io, "SyncDrop Settings");
    const pick = await menu(
      io,
      [{ label: "Defaults" }, { label: "Menu order" }, { label: "Modifier keys  (Ctrl = move, Shift = link)" }, { label: "Folders  (add, remove, rename, reorder)" }, { label: "File managers  (add or remove the menu)" }],
      "Quit SyncDrop Settings",
    );
    if (pick === null) {
      io.out("Settings closed. Restart your file manager to see any changes.");
      return EXIT.OK;
    }
    await [defaultsScreen, orderScreen, keysScreen, foldersScreen, managersScreen][pick]?.(io, st);
  }
}
