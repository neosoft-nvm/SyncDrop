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
});
