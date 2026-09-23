import { describe, expect, it } from "vitest";
import { keepBothName } from "../../src/core/conflicts.js";

describe("keepBothName", () => {
  it("adds (n) before the extension", () => {
    expect(keepBothName("/d/report.pdf", 1, false)).toBe("/d/report (1).pdf");
    expect(keepBothName("/d/report.pdf", 2, false)).toBe("/d/report (2).pdf");
  });
  it("handles multi-dot, dotfiles and no extension", () => {
    expect(keepBothName("/d/a.tar.gz", 1, false)).toBe("/d/a.tar (1).gz");
    expect(keepBothName("/d/.bashrc", 1, false)).toBe("/d/.bashrc (1)");
    expect(keepBothName("/d/Makefile", 1, false)).toBe("/d/Makefile (1)");
  });
  it("suffixes the whole name for directories", () => {
    expect(keepBothName("/d/my.app", 1, true)).toBe("/d/my.app (1)");
  });
});
