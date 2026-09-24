import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run, type CliIO } from "../../src/cli/cli.js";
import { cleanupTmp, read, tmpDir, tree, write } from "../helpers.js";
import { mkdir, writeFile } from "node:fs/promises";

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
      answers: [a, "y", "Movies", "y", b, "Papers", "y", "y", c2, "Papers", "y", "n"],
    });
    expect(await run(["config", "init"], c.io)).toBe(0);
    const t = JSON.parse(await read(process.env.SYNCDROP_CONFIG)).targets;
    expect(t.main.name).toBe("Movies");
    expect(t.papers).toMatchObject({ name: "Papers", path: b });
    expect(t["papers-2"]).toMatchObject({ name: "Papers", path: c2 });
  });

  it("config init stops at 10 folders in total and points at the config file", async () => {
    process.env.SYNCDROP_CONFIG = path.join(root, "new", "config.json");
    const answers = [path.join(root, "F0"), "y", "F0", ...Array.from({ length: 9 }, (_, i) => ["y", path.join(root, `F${i + 1}`), `F${i + 1}`, "y"]).flat()];
    const c = fakeIO({ interactive: true, answers });
    expect(await run(["config", "init"], c.io)).toBe(0);
    expect(Object.keys(JSON.parse(await read(process.env.SYNCDROP_CONFIG)).targets)).toHaveLength(10);
    expect(c.out.join("\n")).toContain("edit the SyncDrop config file");
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
});
