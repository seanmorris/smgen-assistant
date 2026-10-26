// @ts-check

import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const lotusIcon = await readFile(path.join(root, "src/browser/lotus.svg"), "utf8");

await rm(output, { recursive: true, force: true });
if (process.argv.includes("--clean")) process.exit(0);

await mkdir(path.join(output, "cli"), { recursive: true });
await mkdir(path.join(output, "browser"), { recursive: true });

await build({
  entryPoints: [path.join(root, "src/cli/index.mjs")],
  outfile: path.join(output, "cli/index.mjs"),
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "eof"
});

await build({
  entryPoints: [path.join(root, "src/browser/loader.mjs")],
  outfile: path.join(output, "browser/loader.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["es2022"],
  minify: true,
  define: {
    "globalThis.__SMGEN_ASSISTANT_LOTUS_ICON__": JSON.stringify(lotusIcon)
  },
  legalComments: "none"
});

await build({
  entryPoints: {
    frame: path.join(root, "src/browser/frame.mjs"),
    "engine-worker": path.join(root, "src/browser/engine-worker.mjs"),
    "service-worker": path.join(root, "src/browser/service-worker.mjs")
  },
  outdir: path.join(output, "browser"),
  bundle: true,
  splitting: true,
  platform: "browser",
  external: ["url"],
  format: "esm",
  target: ["es2022"],
  minify: true,
  chunkNames: "chunks/[name]-[hash]",
  entryNames: "[name]",
  legalComments: "eof"
});

await Promise.all([
  cp(path.join(root, "src/browser/frame.html"), path.join(output, "browser/frame.html")),
  cp(path.join(root, "src/styles/assistant.css"), path.join(output, "browser/assistant.css")),
  cp(path.join(root, "src/browser/logo.svg"), path.join(output, "browser/logo.svg")),
  cp(path.join(root, "src/browser/lotus.svg"), path.join(output, "browser/lotus.svg"))
]);
