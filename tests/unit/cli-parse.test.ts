import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/cli/cli.js";
import { ArgsError } from "../../src/core/errors.js";

describe("parseArgs", () => {
  it("parses flags, values and positionals", () => {
    const p = parseArgs(["add", "-t", "main", "--conflict=skip", "--notify", "a", "b"]);
    expect(p.positionals).toEqual(["add", "a", "b"]);
    expect(p.flags.get("target")).toBe("main");
    expect(p.flags.get("conflict")).toBe("skip");
    expect(p.flags.has("notify")).toBe(true);
  });
  it("treats everything after -- as positional", () => {
    expect(parseArgs(["add", "--", "-weird", "--name"]).positionals).toEqual(["add", "-weird", "--name"]);
  });
  it("rejects unknown options and missing values", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(ArgsError);
    expect(() => parseArgs(["add", "--target"])).toThrow(/needs a value/);
  });
});
