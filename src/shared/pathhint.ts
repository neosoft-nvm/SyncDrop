import os from "node:os";
import path from "node:path";

/** Plain-language steps for putting `dir` on PATH, for the user's login shell. */
export function pathAdvice(dir: string, shell = process.env.SHELL ?? ""): string[] {
  const shown = dir.startsWith(os.homedir()) ? "~" + dir.slice(os.homedir().length) : dir;
  const name = path.basename(shell);
  const rc = name === "zsh" ? "~/.zshrc" : name === "bash" ? "~/.bashrc" : "~/.profile";
  const fix =
    name === "fish"
      ? `fish_add_path ${shown}`
      : `echo 'export PATH="${shown}:$PATH"' >> ${rc}`.replace(`"~/`, `"$HOME/`);
  return [
    `To use 'syncdrop' in a terminal, add ${shown} to your PATH. Copy this line, paste it into the terminal, press Enter:`,
    `    ${fix}`,
    "Then open a new terminal window. (Many systems add this folder to PATH by themselves at your next login, so logging out and back in may be enough.)",
    "The right-click menu works either way; only typing 'syncdrop' in a terminal is affected.",
  ];
}
