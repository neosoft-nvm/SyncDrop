import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expandPath, isSameOrInside } from "../../src/shared/paths.js";

describe("expandPath", () => {
  it("expands ~ and ~/x", () => {
    expect(expandPath("~", { home: "/h" })).toBe("/h");
    expect(expandPath("~/SyncDrop", { home: "/h" })).toBe(path.join("/h", "SyncDrop"));
  });
  it("leaves other paths alone", () => {
    expect(expandPath("/a/b~c")).toBe("/a/b~c");
    expect(expandPath("~other/x", { home: "/h" })).toBe("~other/x");
  });
  it("uses the real home by default", () => {
    expect(expandPath("~/x")).toBe(path.join(os.homedir(), "x"));
  });
  it("expands %VAR% on Windows only", () => {
    expect(expandPath("%USERPROFILE%\\Sync", { platform: "win32", env: { USERPROFILE: "C:\\U" } })).toBe("C:\\U\\Sync");
    expect(expandPath("%X%/a", { platform: "linux", env: { X: "y" } })).toBe("%X%/a");
  });
});

describe("isSameOrInside", () => {
  it("detects equality and nesting", () => {
    expect(isSameOrInside("/a/b", "/a/b")).toBe(true);
    expect(isSameOrInside("/a/b", "/a/b/c/d")).toBe(true);
  });
  it("does not confuse siblings with similar prefixes", () => {
    expect(isSameOrInside("/a/b", "/a/bc")).toBe(false);
    expect(isSameOrInside("/a/b", "/a")).toBe(false);
    expect(isSameOrInside("/a/b", "/a/..b")).toBe(false);
  });
});
