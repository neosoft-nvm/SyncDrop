import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let cached: string | undefined;

/** Version from package.json (works from both src/ and dist/). */
export function getVersion(): string {
  if (!cached) {
    const file = fileURLToPath(new URL("../../package.json", import.meta.url));
    cached = (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
  }
  return cached;
}
