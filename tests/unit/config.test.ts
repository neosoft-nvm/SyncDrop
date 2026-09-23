import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { loadConfig, validateConfig, writeDefaultConfig } from "../../src/config/config.js";
import { ConfigError } from "../../src/core/errors.js";
import { cleanupTmp, tmpDir, write } from "../helpers.js";

cleanupTmp();
const target = { name: "T", path: "/data/t", backend: "syncthing" };

describe("validateConfig", () => {
  it("accepts the default config and resolves ~", () => {
    const r = validateConfig(DEFAULT_CONFIG);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.targets.main?.path).not.toContain("~");
      expect(r.value.defaults.target).toBe("main");
    }
  });
  it("config/default.json matches DEFAULT_CONFIG", async () => {
    const file = path.resolve(import.meta.dirname, "../../config/default.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(DEFAULT_CONFIG);
  });
  it("rejects wrong version", () => {
    expect(validateConfig({ version: 2, targets: { a: target } })).toMatchObject({ ok: false });
  });
  it("rejects invalid ids", () => {
    const r = validateConfig({ version: 1, targets: { "bad id": target } });
    expect(r.ok).toBe(false);
  });
  it("rejects ids that differ only by case", () => {
    const r = validateConfig({ version: 1, targets: { Main: target, main: target } });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error.join()).toMatch(/duplicate/);
  });
  it("rejects relative paths, unknown backends and missing fields", () => {
    const r = validateConfig({
      version: 1,
      targets: { a: { name: "A", path: "rel/dir", backend: "syncthing" }, b: { name: "B", path: "/x", backend: "ftp" }, c: {} },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThanOrEqual(3);
  });
  it("rejects a default target that does not exist", () => {
    expect(validateConfig({ version: 1, targets: { a: target }, defaults: { target: "nope" } }).ok).toBe(false);
  });
  it("rejects bad default policies", () => {
    expect(validateConfig({ version: 1, targets: { a: target }, defaults: { conflict: "nuke" } }).ok).toBe(false);
  });
  it("preserves unknown fields in raw", () => {
    const r = validateConfig({ version: 1, targets: { a: { ...target, future: 1 } }, extra: { x: 1 } });
    expect(r.ok && r.value.raw.extra).toEqual({ x: 1 });
    expect(r.ok && r.value.raw.targets.a?.future).toBe(1);
  });
});

describe("loadConfig / writeDefaultConfig", () => {
  it("reports a missing file with a hint", async () => {
    const dir = await tmpDir();
    await expect(loadConfig(path.join(dir, "none.json"))).rejects.toThrow(/config init/);
  });
  it("reports invalid JSON as a ConfigError", async () => {
    const f = await write(path.join(await tmpDir(), "c.json"), "{oops");
    await expect(loadConfig(f)).rejects.toBeInstanceOf(ConfigError);
  });
  it("writes defaults once and refuses to overwrite without force", async () => {
    const f = path.join(await tmpDir(), "sub", "config.json");
    await writeDefaultConfig(f);
    expect((await loadConfig(f)).defaults.target).toBe("main");
    await expect(writeDefaultConfig(f)).rejects.toThrow(/already exists/);
    await writeDefaultConfig(f, true);
  });
});
