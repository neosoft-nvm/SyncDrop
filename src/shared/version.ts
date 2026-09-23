import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Injected by the bundler (scripts/build-binary.mjs); undefined when running from tsc output. */
declare const __SYNCDROP_VERSION__: string | undefined;

let cached: string | undefined;

/** Version from package.json (works from both src/ and dist/). */
export function getVersion(): string {
  if (!cached && typeof __SYNCDROP_VERSION__ !== "undefined") cached = __SYNCDROP_VERSION__;
  if (!cached) {
    const file = fileURLToPath(new URL("../../package.json", import.meta.url));
    cached = (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
  }
  return cached;
}
