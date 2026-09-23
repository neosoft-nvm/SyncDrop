// Builds a self-contained `syncdrop` executable (Node Single Executable Application).
// Usage: node scripts/build-binary.mjs [--node <path-to-node-binary>] [--out <file>]
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const nodeBin = arg("--node", process.execPath);
const out = path.resolve(arg("--out", "release/syncdrop"));
const work = path.resolve("release/.build");
const version = JSON.parse(readFileSync("package.json", "utf8")).version;

mkdirSync(work, { recursive: true });
mkdirSync(path.dirname(out), { recursive: true });

await build({
  entryPoints: ["src/cli/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs", // SEA main scripts must be CommonJS
  target: "node22",
  outfile: path.join(work, "bundle.cjs"),
  define: { __SYNCDROP_VERSION__: JSON.stringify(version), "import.meta.url": "__importMetaUrl" },
  banner: { js: 'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
});

writeFileSync(
  path.join(work, "sea-config.json"),
  JSON.stringify({ main: path.join(work, "bundle.cjs"), output: path.join(work, "sea.blob"), disableExperimentalSEAWarning: true }),
);
execFileSync(nodeBin, ["--experimental-sea-config", path.join(work, "sea-config.json")], { stdio: "inherit" });

copyFileSync(nodeBin, out);
chmodSync(out, 0o755);
execFileSync(
  "npx",
  ["postject", out, "NODE_SEA_BLOB", path.join(work, "sea.blob"), "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"],
  { stdio: "inherit" },
);
console.log(`built ${out} (v${version})`);
