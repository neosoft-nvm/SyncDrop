import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run, type CliIO } from "../../src/cli/cli.js";
import { cleanupTmp, read, tmpDir, tree, write } from "../helpers.js";
import { lstat, mkdir, readlink, writeFile } from "node:fs/promises";

cleanupTmp();

function fakeIO(opts: { interactive?: boolean; answers?: string[] } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const notes: string[][] = [];
  const answers = [...(opts.answers ?? [])];
  const io: CliIO = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    interactive: opts.interactive ?? false,
    ask: async () => answers.shift() ?? "",
    notify: (t, b) => notes.push([t, b]),
  };
  return { io, out, err, notes };
}

let root: string;
let dest: string;
const saved = { ...process.env };

beforeEach(async () => {
  root = await tmpDir();
  dest = path.join(root, "SyncDrop");
  await mkdir(dest);
  const cfg = path.join(root, "config.json");
  await writeFile(cfg, JSON.stringify({ version: 1, targets: { main: { name: "Main Sync", path: dest, backend: "syncthing" } }, defaults: { operation: "copy", target: "main", conflict: "ask" } }));
  process.env.SYNCDROP_CONFIG = cfg;
  process.env.SYNCDROP_HISTORY = path.join(root, "history.jsonl");
});
afterEach(() => {
  process.env = { ...saved };
});

describe("cli", () => {
  it("--version and --help", async () => {
    const v = fakeIO();
    expect(await run(["--version"], v.io)).toBe(0);
    expect(v.out[0]).toMatch(/^\d+\.\d+\.\d+/);
    const h = fakeIO();
    expect(await run(["--help"], h.io)).toBe(0);
    expect(h.out.join("\n")).toContain("add FILE...");
  });

  it("lists targets as a table and as JSON", async () => {
    const t = fakeIO();
    expect(await run(["targets"], t.io)).toBe(0);
    expect(t.out.join("\n")).toContain("Main Sync");
    const j = fakeIO();
    await run(["target", "list", "--json"], j.io);
    expect(JSON.parse(j.out.join("\n"))).toEqual([{ id: "main", name: "Main Sync", backend: "syncthing", path: dest, exists: true }]);
  });

  it("adds files using the default target and records history", async () => {
    const f = await write(path.join(root, "in/a.txt"), "A");
    const c = fakeIO();
    expect(await run(["add", "--conflict", "skip", f], c.io)).toBe(0);
    expect(await read(path.join(dest, "a.txt"))).toBe("A");
    const h = fakeIO();
    await run(["history"], h.io);
    expect(h.out[0]).toContain("a.txt");
  });

  it("exit 4 on a conflict when non-interactive, and the destination is untouched", async () => {
    await write(path.join(dest, "a.txt"), "OLD");
    const f = await write(path.join(root, "in/a.txt"), "NEW");
    const c = fakeIO();
    expect(await run(["add", "-t", "main", f], c.io)).toBe(4);
    expect(c.err.join("\n")).toContain("--conflict");
    expect(await read(path.join(dest, "a.txt"))).toBe("OLD");
  });

  it("asks interactively when a terminal is available", async () => {
    await write(path.join(dest, "a.txt"), "OLD");
    const f = await write(path.join(root, "in/a.txt"), "NEW");
    const c = fakeIO({ interactive: true, answers: ["k"] });
    expect(await run(["add", f], c.io)).toBe(0);
    expect(await tree(dest)).toEqual(["a (1).txt", "a.txt"]);
    const abort = fakeIO({ interactive: true, answers: ["a"] });
    expect(await run(["add", f], abort.io)).toBe(4);
  });

  it("maps errors to exit codes", async () => {
    const f = await write(path.join(root, "in/a.txt"));
    expect(await run(["add", "-t", "nope", f], fakeIO().io)).toBe(2);
    expect(await run(["add"], fakeIO().io)).toBe(2);
    expect(await run(["add", "--conflict", "bogus", f], fakeIO().io)).toBe(2);
    expect(await run(["frobnicate"], fakeIO().io)).toBe(2);
    expect(await run(["add", path.join(root, "ghost")], fakeIO().io)).toBe(1);
    process.env.SYNCDROP_CONFIG = path.join(root, "missing.json");
    expect(await run(["targets"], fakeIO().io)).toBe(3);
  });

  it("supports move and --notify", async () => {
    const f = await write(path.join(root, "in/a.txt"));
    const c = fakeIO();
    expect(await run(["add", "-o", "move", "-c", "skip", "--notify", "--", f], c.io)).toBe(0);
    expect(await tree(path.join(root, "in"))).toEqual([]);
    expect(c.notes[0]?.[1]).toContain("Main Sync");
  });

  it("config path / init", async () => {
    const c = fakeIO();
    await run(["config", "path"], c.io);
    expect(c.out[0]).toBe(process.env.SYNCDROP_CONFIG);
    process.env.SYNCDROP_CONFIG = path.join(root, "new", "config.json");
    expect(await run(["config", "init"], fakeIO().io)).toBe(0);
    expect(await run(["config", "init"], fakeIO().io)).toBe(3);
  });

  it("config init prompts for the sync folder and creates it", async () => {
    process.env.SYNCDROP_CONFIG = path.join(root, "new", "config.json");
    const folder = path.join(root, "Synced");
    const c = fakeIO({ interactive: true, answers: [folder, "y"] });
    expect(await run(["config", "init"], c.io)).toBe(0);
    const cfg = JSON.parse(await read(process.env.SYNCDROP_CONFIG));
    expect(Object.keys(cfg.targets)).toEqual(["main"]);
    expect(cfg.targets.main.path).toBe(folder);
    expect((await tree(folder)).length).toBe(0);
  });

  it("config init asks for a menu name and up to 10 extra folders", async () => {
    process.env.SYNCDROP_CONFIG = path.join(root, "new", "config.json");
    const [a, b, c2] = ["Videos", "Docs", "Docs2"].map((n) => path.join(root, n));
    const c = fakeIO({
      interactive: true,
      answers: [a, "y", "Movies", "y", b, "y", "Papers", "y", c2, "y", "Papers", "y", "n"],
    });
    expect(await run(["config", "init"], c.io)).toBe(0);
    const t = JSON.parse(await read(process.env.SYNCDROP_CONFIG)).targets;
    expect(t.main.name).toBe("Movies");
    expect(t.papers).toMatchObject({ name: "Papers", path: b });
    expect(t["papers-2"]).toMatchObject({ name: "Papers", path: c2 });
  });

  it("config init stops at 10 folders in total and points at the config file", async () => {
    process.env.SYNCDROP_CONFIG = path.join(root, "new", "config.json");
    const answers = [path.join(root, "F0"), "y", "F0", ...Array.from({ length: 9 }, (_, i) => ["y", path.join(root, `F${i + 1}`), "y", `F${i + 1}`]).flat()];
    const c = fakeIO({ interactive: true, answers });
    expect(await run(["config", "init"], c.io)).toBe(0);
    expect(Object.keys(JSON.parse(await read(process.env.SYNCDROP_CONFIG)).targets)).toHaveLength(10);
    expect(c.out.join("\n")).toContain("edit the SyncDrop config file");
  });

  it("config init re-asks on a bad folder instead of quitting", async () => {
    process.env.SYNCDROP_CONFIG = path.join(root, "new", "config.json");
    const file = await write(path.join(root, "a-file"));
    const good = path.join(root, "Good");
    // relative path, a file, a typo the user refuses to create, then a good folder; name; no extras
    const c = fakeIO({ interactive: true, answers: ["Documents", file, path.join(root, "typo"), "n", "n", good, "y", "", "n"] });
    expect(await run(["config", "init"], c.io)).toBe(0);
    expect(c.err.join("\n")).toContain("must be absolute");
    expect(c.err.join("\n")).toContain("not a folder");
    expect(c.err.join("\n")).toContain("try again");
    expect(JSON.parse(await read(process.env.SYNCDROP_CONFIG)).targets.main.path).toBe(good);
  });

  it("an extra folder can be abandoned with Enter, and a bad one is re-asked", async () => {
    process.env.SYNCDROP_CONFIG = path.join(root, "new", "config.json");
    const main = path.join(root, "M");
    const c = fakeIO({ interactive: true, answers: [main, "y", "", "y", "relative/dir", ""] });
    expect(await run(["config", "init"], c.io)).toBe(0);
    expect(Object.keys(JSON.parse(await read(process.env.SYNCDROP_CONFIG)).targets)).toEqual(["main"]);
  });

  it("config init warns about a duplicate name or folder and lets the user decide", async () => {
    process.env.SYNCDROP_CONFIG = path.join(root, "new", "config.json");
    const [m, d] = [path.join(root, "M"), path.join(root, "D")];
    // second folder: same folder as the first (say no, then pick D), name "m" clashes with "M" (say no, then "Other")
    const c = fakeIO({ interactive: true, answers: [m, "y", "M", "y", m, "n", d, "y", "m", "n", "Other", "n"] });
    expect(await run(["config", "init"], c.io)).toBe(0);
    const out = c.out.join("\n");
    expect(out).toContain('already in the list as "M"');
    expect(out).toContain('The name "m" is already used');
    expect(Object.values(JSON.parse(await read(process.env.SYNCDROP_CONFIG)).targets).map((t) => (t as { name: string }).name)).toEqual(["M", "Other"]);
  });

  it("setup offers to keep the current settings or create new ones (backing up the old)", async () => {
    process.env.SYNCDROP_CONFIG = path.join(root, "new", "config.json");
    process.env.XDG_CONFIG_HOME = path.join(root, "xc");
    process.env.XDG_DATA_HOME = path.join(root, "xd");
    const one = path.join(root, "One");
    await run(["config", "init", "--path", one], fakeIO().io);
    const keep = fakeIO({ interactive: true, answers: ["1"] });
    await run(["setup"], keep.io);
    expect(keep.out.join("\n")).toContain("Keeping your existing settings");
    expect(JSON.parse(await read(process.env.SYNCDROP_CONFIG)).targets.main.path).toBe(one);
    const two = path.join(root, "Two");
    const fresh = fakeIO({ interactive: true, answers: ["2", two, "y", "", "n"] });
    await run(["setup"], fresh.io);
    expect(JSON.parse(await read(process.env.SYNCDROP_CONFIG)).targets.main.path).toBe(two);
    expect(JSON.parse(await read(process.env.SYNCDROP_CONFIG + ".bak")).targets.main.path).toBe(one);
  });

  it("target add refuses a duplicate name or folder unless --force", async () => {
    expect(await run(["target", "add", "main sync", "--path", path.join(root, "x")], fakeIO().io)).toBe(2);
    expect(await run(["target", "add", "Other", "--path", dest], fakeIO().io)).toBe(2);
    expect(await run(["target", "add", "main sync", "--path", path.join(root, "x"), "--force"], fakeIO().io)).toBe(0);
  });

  it("settings: shows the folder list when removing, accepts a name, and has a Quit option", async () => {
    process.env.XDG_CONFIG_HOME = path.join(root, "xc");
    process.env.XDG_DATA_HOME = path.join(root, "xd");
    await run(["target", "add", "Photos", "--path", path.join(root, "p")], fakeIO().io);
    // 4 Folders > 2 Remove > "photos" > y > 0 back > 0 quit
    const c = fakeIO({ interactive: true, answers: ["4", "2", "photos", "y", "0", "0"] });
    expect(await run(["settings"], c.io)).toBe(0);
    const out = c.out.join("\n");
    expect(out).toContain("1. Main Sync");
    expect(out).toContain("2. Photos");
    expect(out).toContain("Quit SyncDrop Settings");
    expect(Object.keys(JSON.parse(await read(process.env.SYNCDROP_CONFIG as string)).targets)).toEqual(["main"]);
  });

  it("config init --path works without a terminal and warns if missing", async () => {
    process.env.SYNCDROP_CONFIG = path.join(root, "new", "config.json");
    const c = fakeIO();
    expect(await run(["config", "init", "--path", path.join(root, "Nope")], c.io)).toBe(0);
    expect(c.err.join("\n")).toContain("does not exist");
    expect(JSON.parse(await read(process.env.SYNCDROP_CONFIG)).targets.main.path).toBe(path.join(root, "Nope"));
  });

  it("config init without a terminal or --path keeps the default targets", async () => {
    process.env.SYNCDROP_CONFIG = path.join(root, "new", "config.json");
    expect(await run(["config", "init"], fakeIO().io)).toBe(0);
    expect(Object.keys(JSON.parse(await read(process.env.SYNCDROP_CONFIG)).targets)).toHaveLength(3);
  });
  it("setup creates the config from --path, installs menus into XDG dirs, and keeps an existing config", async () => {
    process.env.SYNCDROP_CONFIG = path.join(root, "new", "config.json");
    process.env.XDG_CONFIG_HOME = path.join(root, "xdg-config");
    process.env.XDG_DATA_HOME = path.join(root, "xdg-data");
    const folder = path.join(root, "Synced");
    expect(await run(["setup", "--path", folder], fakeIO().io)).toBe(0);
    expect(JSON.parse(await read(process.env.SYNCDROP_CONFIG)).targets.main.path).toBe(folder);
    const again = fakeIO();
    expect(await run(["setup", "--path", path.join(root, "Other")], again.io)).toBe(0);
    expect(again.out.join("\n")).toContain("Keeping your existing settings");
    expect(JSON.parse(await read(process.env.SYNCDROP_CONFIG)).targets.main.path).toBe(folder);
  });

  it("uninstall removes menu entries, keeps config unless --purge, never touches synced files", async () => {
    process.env.SYNCDROP_CONFIG = path.join(root, "new", "config.json");
    process.env.XDG_CONFIG_HOME = path.join(root, "xdg-config");
    process.env.XDG_DATA_HOME = path.join(root, "xdg-data");
    process.env.XDG_STATE_HOME = path.join(root, "xdg-state");
    const folder = path.join(root, "Synced");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "keep.txt"), "x");
    expect(await run(["setup", "--path", folder], fakeIO().io)).toBe(0);
    expect(await run(["uninstall"], fakeIO().io)).toBe(0);
    expect(await read(process.env.SYNCDROP_CONFIG)).toContain("main");
    const c = fakeIO();
    expect(await run(["uninstall", "--purge"], c.io)).toBe(0);
    await expect(read(process.env.SYNCDROP_CONFIG)).rejects.toThrow();
    expect(await read(path.join(folder, "keep.txt"))).toBe("x");
    expect(await run(["uninstall"], fakeIO().io)).toBe(0); // idempotent
  });

  describe("link, menu settings and ordering", () => {
    beforeEach(() => {
      process.env.XDG_CONFIG_HOME = path.join(root, "xdg-config");
      process.env.XDG_DATA_HOME = path.join(root, "xdg-data");
    });

    it("link puts a symlink in the target and leaves the source alone", async () => {
      const f = await write(path.join(root, "in/a.txt"), "hello");
      const c = fakeIO();
      expect(await run(["add", "-o", "link", "-c", "skip", "--", f], c.io)).toBe(0);
      const l = path.join(dest, "a.txt");
      expect((await lstat(l)).isSymbolicLink()).toBe(true);
      expect(await readlink(l)).toBe(f);
      expect(await read(f)).toBe("hello");
      expect(c.out[0]).toContain("linked");
      // second time: keep-both makes a numbered link, overwrite replaces a link, but never a real file
      expect(await run(["add", "-o", "link", "-c", "keep-both", "--", f], fakeIO().io)).toBe(0);
      expect((await lstat(path.join(dest, "a (1).txt"))).isSymbolicLink()).toBe(true);
      expect(await run(["add", "-o", "link", "-c", "overwrite", "--", f], fakeIO().io)).toBe(0);
      await write(path.join(dest, "real.txt"));
      const real = await write(path.join(root, "in/real.txt"));
      expect(await run(["add", "-o", "link", "-c", "overwrite", "--", real], fakeIO().io)).toBe(1);
      expect(await read(path.join(dest, "real.txt"))).toBe("x");
    });

    it("link of a folder is a link to the folder", async () => {
      await write(path.join(root, "in/dir/f.txt"));
      expect(await run(["add", "-o", "link", "--", path.join(root, "in/dir")], fakeIO().io)).toBe(0);
      expect((await lstat(path.join(dest, "dir"))).isSymbolicLink()).toBe(true);
    });

    it("adds, orders, renames and removes folders, keeping unknown config fields", async () => {
      const cfg = process.env.SYNCDROP_CONFIG as string;
      const raw = JSON.parse(await read(cfg));
      await writeFile(cfg, JSON.stringify({ ...raw, custom: { keep: true } }));
      const ids = async () => { const c = fakeIO(); await run(["targets", "--json"], c.io); return (JSON.parse(c.out.join("\n")) as { id: string }[]).map((t) => t.id); };

      expect(await run(["target", "add", "Photos", "--path", path.join(root, "p")], fakeIO().io)).toBe(0);
      expect(await run(["target", "add", "Docs", "--path", path.join(root, "d")], fakeIO().io)).toBe(0);
      expect(await ids()).toEqual(["main", "photos", "docs"]);
      expect(await run(["target", "move", "docs", "1"], fakeIO().io)).toBe(0);
      expect(await ids()).toEqual(["docs", "main", "photos"]);
      expect(await run(["target", "rename", "docs", "My Docs"], fakeIO().io)).toBe(0);
      expect(await run(["target", "remove", "main"], fakeIO().io)).toBe(0);
      expect(await ids()).toEqual(["docs", "photos"]);
      const after = JSON.parse(await read(cfg));
      expect(after.custom).toEqual({ keep: true });
      expect(after.defaults.target).toBe("docs"); // default moved off the removed target
      expect(await run(["target", "remove", "photos"], fakeIO().io)).toBe(0);
      expect(await run(["target", "remove", "docs"], fakeIO().io)).toBe(3); // last one is protected
    });

    it("menu shows one Copy entry per folder plus what Ctrl and Shift do; config set changes it", async () => {
      const cfg = () => read(process.env.SYNCDROP_CONFIG as string).then((t) => JSON.parse(t));
      const c = fakeIO();
      await run(["menu"], c.io);
      expect(c.out).toEqual(["Copy to Main Sync", "Hold Ctrl: move   Hold Shift: link"]);
      expect(await run(["config", "set", "ctrl-move", "no"], fakeIO().io)).toBe(0);
      expect(await run(["config", "set", "shift-link", "off"], fakeIO().io)).toBe(0);
      const j = fakeIO();
      await run(["menu", "--json"], j.io);
      expect(JSON.parse(j.out.join("\n")).modifiers).toEqual({ ctrl: null, shift: null });
      expect((await cfg()).menu).toEqual({ ctrlMove: false, shiftLink: false });
      expect(await run(["config", "set", "ctrl-move", "maybe"], fakeIO().io)).toBe(2);
      expect(await run(["config", "set", "operation", "link"], fakeIO().io)).toBe(0);
      expect((await cfg()).defaults.operation).toBe("link");
    });

    it("an old config with menu.operations still loads (the field is ignored and kept)", async () => {
      const file = process.env.SYNCDROP_CONFIG as string;
      const raw = JSON.parse(await read(file));
      await writeFile(file, JSON.stringify({ ...raw, menu: { operations: ["link", "copy"] } }));
      expect(await run(["menu"], fakeIO().io)).toBe(0);
    });

    it("changing menu options refreshes menus that are already installed", async () => {
      expect(await run(["integrate", "install", "dolphin"], fakeIO().io)).toBe(0);
      const file = path.join(root, "xdg-data", "kio", "servicemenus", "syncdrop.desktop");
      expect(await read(file)).not.toContain("Move to");
      expect(await run(["config", "set", "extra-entries", "yes"], fakeIO().io)).toBe(0);
      expect(await read(file)).toContain("Move to Main Sync");
    });

    it("settings: the Modifier keys screen switches Ctrl-move and Shift-link", async () => {
      // 3 Modifier keys > 1 (Ctrl) > 2 (Shift) > 3 (extra entries) > back > quit
      const c = fakeIO({ interactive: true, answers: ["3", "1", "2", "3", "0", "0"] });
      expect(await run(["settings"], c.io)).toBe(0);
      expect(JSON.parse(await read(process.env.SYNCDROP_CONFIG as string)).menu).toEqual({ ctrlMove: false, shiftLink: false, explicitEntries: true });
    });

    it("settings needs a terminal, and edits defaults when there is one", async () => {
      expect(await run(["settings"], fakeIO().io)).toBe(2);
      // 1 Defaults > 1 operation > 3 link, then Enter to leave
      const c = fakeIO({ interactive: true, answers: ["1", "1", "3", ""] });
      expect(await run(["settings"], c.io)).toBe(0);
      expect(JSON.parse(await read(process.env.SYNCDROP_CONFIG as string)).defaults.operation).toBe("link");
    });
  });
});
