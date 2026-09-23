import { chmod, lstat, mkdir, readdir, readlink, rename, stat, symlink, utimes } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonlHistory } from "../../src/core/history.js";
import { SyncDrop } from "../../src/core/syncdrop.js";
import type { ConflictResolver } from "../../src/core/conflicts.js";
import { cleanupTmp, makeConfig, read, tmpDir, tree, write } from "../helpers.js";

cleanupTmp();

async function setup(opts: { resolver?: ConflictResolver; history?: JsonlHistory } = {}) {
  const root = await tmpDir();
  const src = path.join(root, "src");
  const dest = path.join(root, "SyncDrop");
  await mkdir(src);
  await mkdir(dest);
  const sd = new SyncDrop({ config: makeConfig({ main: dest }), cwd: root, ...opts });
  return { root, src, dest, sd };
}

describe("copy", () => {
  it("1: copies a single file", async () => {
    const { src, dest, sd } = await setup();
    const f = await write(path.join(src, "test.txt"), "hello");
    const [r] = await sd.add({ sources: [f], targetId: "main", conflict: "skip" });
    expect(r).toMatchObject({ success: true, destination: path.join(dest, "test.txt") });
    expect(await read(path.join(dest, "test.txt"))).toBe("hello");
    expect(await read(f)).toBe("hello"); // source untouched
  });

  it("2: copies a directory tree, keeping the directory itself", async () => {
    const { src, dest, sd } = await setup();
    await write(path.join(src, "MyApp/package.json"));
    await write(path.join(src, "MyApp/src/deep/a.ts"));
    await mkdir(path.join(src, "MyApp/empty"));
    await sd.add({ sources: [path.join(src, "MyApp")], targetId: "main", conflict: "skip" });
    expect(await tree(dest)).toEqual(["MyApp/", "MyApp/empty/", "MyApp/package.json", "MyApp/src/", "MyApp/src/deep/", "MyApp/src/deep/a.ts"]);
  });

  it("3-5: multiple files, multiple dirs, mixed", async () => {
    const { src, dest, sd } = await setup();
    const files = [await write(path.join(src, "a.pdf")), await write(path.join(src, "b.jpg"))];
    await write(path.join(src, "P1/x.txt"));
    await write(path.join(src, "P2/y/z.txt"));
    const results = await sd.add({
      sources: [...files, path.join(src, "P1"), path.join(src, "P2")],
      targetId: "main",
      conflict: "skip",
    });
    expect(results.every((r) => r.success)).toBe(true);
    expect(await tree(dest)).toEqual(["P1/", "P1/x.txt", "P2/", "P2/y/", "P2/y/z.txt", "a.pdf", "b.jpg"]);
  });

  it("resolves relative sources against cwd and ignores duplicates", async () => {
    const { root, src, dest, sd } = await setup();
    await write(path.join(src, "r.txt"));
    const results = await sd.add({ sources: ["src/r.txt", path.join(src, "r.txt")], targetId: "main", conflict: "skip" });
    expect(results).toHaveLength(1);
    expect(await tree(dest)).toEqual(["r.txt"]);
    expect(root).toBeTruthy();
  });

  it("preserves modification time and copies symlinks as links", async () => {
    const { src, dest, sd } = await setup();
    const f = await write(path.join(src, "t.txt"));
    const when = new Date("2020-01-02T03:04:05Z");
    await utimes(f, when, when);
    await symlink("t.txt", path.join(src, "link"));
    await sd.add({ sources: [f, path.join(src, "link")], targetId: "main", conflict: "skip" });
    expect((await stat(path.join(dest, "t.txt"))).mtime.getTime()).toBe(when.getTime());
    expect(await readlink(path.join(dest, "link"))).toBe("t.txt");
  });

  it("leaves no temp files behind", async () => {
    const { src, dest, sd } = await setup();
    await sd.add({ sources: [await write(path.join(src, "a.txt"))], targetId: "main", conflict: "skip" });
    expect(await readdir(dest)).toEqual(["a.txt"]);
  });
});

describe("conflicts", () => {
  it("6: never silently overwrites (ask without a resolver fails safely)", async () => {
    const { src, dest, sd } = await setup();
    await write(path.join(dest, "a.txt"), "OLD");
    const [r] = await sd.add({ sources: [await write(path.join(src, "a.txt"), "NEW")], targetId: "main", conflict: "ask" });
    expect(r).toMatchObject({ success: false, errorCode: "CONFLICT" });
    expect(await read(path.join(dest, "a.txt"))).toBe("OLD");
  });

  it("overwrite replaces, skip keeps, keep-both is deterministic", async () => {
    const { src, dest, sd } = await setup();
    const f = await write(path.join(src, "report.pdf"), "NEW");
    await write(path.join(dest, "report.pdf"), "OLD");

    await sd.add({ sources: [f], targetId: "main", conflict: "skip" });
    expect(await read(path.join(dest, "report.pdf"))).toBe("OLD");

    await sd.add({ sources: [f], targetId: "main", conflict: "keep-both" });
    await sd.add({ sources: [f], targetId: "main", conflict: "keep-both" });
    expect(await tree(dest)).toEqual(["report (1).pdf", "report (2).pdf", "report.pdf"]);
    expect(await read(path.join(dest, "report (2).pdf"))).toBe("NEW");
    expect(await read(path.join(dest, "report.pdf"))).toBe("OLD");

    await sd.add({ sources: [f], targetId: "main", conflict: "overwrite" });
    expect(await read(path.join(dest, "report.pdf"))).toBe("NEW");
    expect(await readdir(dest)).toHaveLength(3); // no temp leftovers
  });

  it("reports a skipped source as success with skipped=true", async () => {
    const { src, dest, sd } = await setup();
    await write(path.join(dest, "a.txt"));
    const [r] = await sd.add({ sources: [await write(path.join(src, "a.txt"))], targetId: "main", conflict: "skip" });
    expect(r).toMatchObject({ success: true, skipped: true });
  });

  it("7: merges into an existing directory without clobbering", async () => {
    const { src, dest, sd } = await setup();
    await write(path.join(dest, "Proj/keep.txt"), "DEST");
    await write(path.join(dest, "Proj/both.txt"), "DEST");
    await write(path.join(src, "Proj/both.txt"), "SRC");
    await write(path.join(src, "Proj/new.txt"), "SRC");
    const [r] = await sd.add({ sources: [path.join(src, "Proj")], targetId: "main", conflict: "skip" });
    expect(r).toMatchObject({ success: true, skippedItems: 1 });
    expect(await read(path.join(dest, "Proj/both.txt"))).toBe("DEST");
    expect(await tree(dest)).toEqual(["Proj/", "Proj/both.txt", "Proj/keep.txt", "Proj/new.txt"]);

    await sd.add({ sources: [path.join(src, "Proj")], targetId: "main", conflict: "keep-both" });
    expect(await read(path.join(dest, "Proj/both (1).txt"))).toBe("SRC");
    expect(await read(path.join(dest, "Proj/both.txt"))).toBe("DEST");
  });

  it("refuses to overwrite a file with a directory (type mismatch)", async () => {
    const { src, dest, sd } = await setup();
    await write(path.join(dest, "thing"), "file");
    await write(path.join(src, "thing/inner.txt"));
    const [r] = await sd.add({ sources: [path.join(src, "thing")], targetId: "main", conflict: "overwrite" });
    expect(r?.success).toBe(false);
    expect(await read(path.join(dest, "thing"))).toBe("file");
  });

  it("uses the interactive resolver, honouring apply-to-all", async () => {
    const asked: string[] = [];
    const { src, dest, sd } = await setup({
      resolver: async ({ destination }) => {
        asked.push(destination);
        return { policy: "keep-both", applyToAll: true };
      },
    });
    await write(path.join(dest, "a.txt"), "OLD");
    await write(path.join(dest, "b.txt"), "OLD");
    const results = await sd.add({
      sources: [await write(path.join(src, "a.txt"), "N"), await write(path.join(src, "b.txt"), "N")],
      targetId: "main",
      conflict: "ask",
    });
    expect(results.every((r) => r.success)).toBe(true);
    expect(asked).toHaveLength(1);
    expect(await tree(dest)).toEqual(["a (1).txt", "a.txt", "b (1).txt", "b.txt"]);
  });
});

describe("safety and errors", () => {
  it("8: prevents copying a directory into itself or its own subtree", async () => {
    const root = await tmpDir();
    const app = path.join(root, "Projects/MyApp");
    await write(path.join(app, "a.txt"));
    const parentTarget = new SyncDrop({ config: makeConfig({ main: path.join(root, "Projects") }), cwd: root });
    const [r1] = await parentTarget.add({ sources: [app], targetId: "main", conflict: "keep-both" });
    expect(r1?.success).toBe(false); // MyApp is already in Projects

    const nested = new SyncDrop({ config: makeConfig({ main: path.join(app, "sub") }), cwd: root });
    await mkdir(path.join(app, "sub"));
    const [r2] = await nested.add({ sources: [app], targetId: "main", conflict: "keep-both" });
    expect(r2).toMatchObject({ success: false });
    expect(r2?.error).toMatch(/into itself/);

    const self = new SyncDrop({ config: makeConfig({ main: app }), cwd: root });
    expect((await self.add({ sources: [app], targetId: "main", conflict: "keep-both" }))[0]?.success).toBe(false);
    expect(await tree(app)).toEqual(["a.txt", "sub/"]); // no MyApp/MyApp/...
  });

  it("8b: detects self-copy through a symlinked target", async () => {
    const root = await tmpDir();
    const app = path.join(root, "app");
    await mkdir(path.join(app, "inner"), { recursive: true });
    await symlink(path.join(app, "inner"), path.join(root, "linked"));
    const sd = new SyncDrop({ config: makeConfig({ main: path.join(root, "linked") }), cwd: root });
    const [r] = await sd.add({ sources: [app], targetId: "main", conflict: "keep-both" });
    expect(r?.success).toBe(false);
    expect(await tree(path.join(app, "inner"))).toEqual([]);
  });

  it("9: missing source fails cleanly without stopping other sources", async () => {
    const { src, dest, sd } = await setup();
    const results = await sd.add({
      sources: [path.join(src, "ghost.txt"), await write(path.join(src, "real.txt"))],
      targetId: "main",
      conflict: "skip",
    });
    expect(results[0]).toMatchObject({ success: false });
    expect(results[0]?.error).toMatch(/does not exist/);
    expect(results[1]?.success).toBe(true);
    expect(await tree(dest)).toEqual(["real.txt"]);
  });

  it("10: unknown target, empty selection, missing target directory", async () => {
    const { src, sd } = await setup();
    const f = await write(path.join(src, "a.txt"));
    await expect(sd.add({ sources: [f], targetId: "nope" })).rejects.toMatchObject({ code: "ARGS" });
    await expect(sd.add({ sources: [], targetId: "main" })).rejects.toMatchObject({ code: "ARGS" });
    const missing = new SyncDrop({ config: makeConfig({ main: path.join(src, "nonexistent") }) });
    await expect(missing.add({ sources: [f], targetId: "main" })).rejects.toMatchObject({ code: "CONFIG" });
  });

  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
    "11: permission failures are reported clearly",
    async () => {
      const { src, dest, sd } = await setup();
      const f = await write(path.join(src, "a.txt"));
      await chmod(dest, 0o555);
      await expect(sd.add({ sources: [f], targetId: "main" })).rejects.toThrow(/no write permission/);
      await chmod(dest, 0o755);

      const secret = await write(path.join(src, "secret.txt"));
      await chmod(secret, 0o000);
      const [r] = await sd.add({ sources: [secret], targetId: "main", conflict: "skip" });
      expect(r).toMatchObject({ success: false });
      expect(r?.error).toMatch(/permission denied/);
    },
  );

  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
    "12: a mid-copy failure is not reported as success and leaves no partial file",
    async () => {
      const { src, dest, sd } = await setup();
      await write(path.join(src, "Tree/a.txt"));
      const bad = await write(path.join(src, "Tree/b.txt"));
      await chmod(bad, 0o000);
      const [r] = await sd.add({ sources: [path.join(src, "Tree")], targetId: "main", conflict: "skip" });
      expect(r?.success).toBe(false);
      const files = await tree(dest);
      expect(files).not.toContain("Tree/b.txt");
      expect(files.some((f) => f.includes(".tmp"))).toBe(false);
    },
  );
});

describe("move", () => {
  it("moves a file and a directory, removing the sources", async () => {
    const { src, dest, sd } = await setup();
    const f = await write(path.join(src, "a.txt"), "A");
    await write(path.join(src, "D/b.txt"), "B");
    const results = await sd.add({ sources: [f, path.join(src, "D")], targetId: "main", operation: "move", conflict: "skip" });
    expect(results.every((r) => r.success)).toBe(true);
    expect(await tree(src)).toEqual([]);
    expect(await tree(dest)).toEqual(["D/", "D/b.txt", "a.txt"]);
  });

  it("keeps the source when the item was skipped", async () => {
    const { src, dest, sd } = await setup();
    await write(path.join(dest, "a.txt"), "OLD");
    const f = await write(path.join(src, "a.txt"), "NEW");
    await sd.add({ sources: [f], targetId: "main", operation: "move", conflict: "skip" });
    expect(await read(f)).toBe("NEW");
    expect(await read(path.join(dest, "a.txt"))).toBe("OLD");
  });

  it("keeps the source (and destination file) on conflict without overwriting", async () => {
    const { src, dest, sd } = await setup();
    await write(path.join(dest, "a.txt"), "OLD");
    const f = await write(path.join(src, "a.txt"), "NEW");
    const [r] = await sd.add({ sources: [f], targetId: "main", operation: "move", conflict: "ask" });
    expect(r?.success).toBe(false);
    expect(await read(f)).toBe("NEW");
    expect(await read(path.join(dest, "a.txt"))).toBe("OLD");
  });

  it("keep-both move removes source only after copying", async () => {
    const { src, dest, sd } = await setup();
    await write(path.join(dest, "a.txt"), "OLD");
    const f = await write(path.join(src, "a.txt"), "NEW");
    await sd.add({ sources: [f], targetId: "main", operation: "move", conflict: "keep-both" });
    expect((await lstat(f).catch(() => null))).toBeNull();
    expect(await read(path.join(dest, "a (1).txt"))).toBe("NEW");
  });

  it("merging a moved directory into an existing one removes the source when nothing was skipped", async () => {
    const { src, dest, sd } = await setup();
    await write(path.join(dest, "D/old.txt"));
    await write(path.join(src, "D/new.txt"));
    await sd.add({ sources: [path.join(src, "D")], targetId: "main", operation: "move", conflict: "skip" });
    expect(await tree(src)).toEqual([]);
    expect(await tree(dest)).toEqual(["D/", "D/new.txt", "D/old.txt"]);
    void rename;
  });
});

describe("history", () => {
  it("records successes and failures", async () => {
    const root = await tmpDir();
    const history = new JsonlHistory(path.join(root, "state", "history.jsonl"));
    const { src, sd } = await setup({ history });
    await sd.add({ sources: [await write(path.join(src, "a.txt")), path.join(src, "ghost")], targetId: "main", conflict: "skip" });
    const entries = await history.recent();
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.success)).toMatchObject({ operation: "copy", target: "main" });
    expect(entries.find((e) => !e.success)?.error).toMatch(/does not exist/);
  });

  it("returns [] when there is no history file", async () => {
    expect(await new JsonlHistory(path.join(await tmpDir(), "none.jsonl")).recent()).toEqual([]);
  });
});
