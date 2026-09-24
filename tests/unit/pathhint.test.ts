import { describe, expect, it } from "vitest";
import { pathAdvice } from "../../src/shared/pathhint.js";

describe("pathAdvice", () => {
  const dir = `${process.env.HOME ?? "/root"}/.local/bin`;
  it("gives a shell-specific one-line fix", () => {
    expect(pathAdvice(dir, "/usr/bin/fish")[1]).toContain("fish_add_path ~/.local/bin");
    expect(pathAdvice(dir, "/bin/zsh")[1]).toContain('>> ~/.zshrc');
    expect(pathAdvice(dir, "/bin/bash")[1]).toContain('export PATH="$HOME/.local/bin:$PATH"');
    expect(pathAdvice(dir, "")[1]).toContain("~/.profile");
  });
  it("says the right-click menu is unaffected", () => {
    expect(pathAdvice(dir, "/bin/bash").join("\n")).toContain("right-click menu works either way");
  });
});
