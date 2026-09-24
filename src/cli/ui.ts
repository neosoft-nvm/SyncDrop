import type { CliIO } from "./cli.js";

const unicode = /utf-?8/i.test(process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || "");
const RULE = (unicode ? "─" : "-").repeat(44);

/** A blank line, a rule, and a title: separates one screen or step from the next. */
export function heading(io: CliIO, title: string): void {
  io.out("");
  io.out(RULE);
  io.out(title);
  io.out(RULE);
}

export const isYes = (answer: string, fallback = false): boolean => (answer.trim() ? /^y/i.test(answer.trim()) : fallback);
