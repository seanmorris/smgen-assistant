// @ts-check

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("build replaces only the reserved assistant directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "smgen-assistant-build-"));
  const pages = path.join(root, "pages");
  const output = path.join(root, "site");
  try {
    await mkdir(pages);
    await mkdir(output);
    await writeFile(path.join(pages, "index.md"), "# Home\n\nWelcome.\n");
    await writeFile(path.join(output, "keep.txt"), "keep\n");
    const { buildSiteAssistant } = await import("../src/cli/build.mjs");
    const publicConfig = {
      version: /** @type {const} */ (1),
      title: "Ask",
      greeting: "Hello",
      model: { id: "test-model", label: "Test", downloadMB: 1, memoryMB: 1 },
      models: [{ id: "test-model", label: "Test", downloadMB: 1, memoryMB: 1 }],
      retrieval: { maxChunks: 2, maxCharacters: 1000 }
    };
    const first = await buildSiteAssistant({ pages, output, baseUrl: "/docs", configPath: undefined, chunkCharacters: 4000, publicConfig });
    const firstCorpus = await readFile(path.join(first.destination, "corpus.json"), "utf8");
    const second = await buildSiteAssistant({ pages, output, baseUrl: "/docs", configPath: undefined, chunkCharacters: 4000, publicConfig });
    assert.equal(await readFile(path.join(output, "keep.txt"), "utf8"), "keep\n");
    assert.equal(await readFile(path.join(second.destination, "corpus.json"), "utf8"), firstCorpus);
    assert.equal(JSON.parse(firstCorpus).sources[0].url, "/docs/index.html");
    assert.match(await readFile(path.join(second.destination, "loader.js"), "utf8"), /frame\.html/u);
    assert.match(await readFile(path.join(second.destination, "lotus.svg"), "utf8"), /Creative Commons Attribution 4\.0/u);
    assert.equal((await stat(second.destination)).mode & 0o777, 0o755);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("build rejects overlapping pages and output directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "smgen-assistant-overlap-"));
  try {
    await mkdir(path.join(root, "pages"));
    await writeFile(path.join(root, "pages", "index.md"), "# Home\n");
    const { buildSiteAssistant } = await import("../src/cli/build.mjs");
    await assert.rejects(buildSiteAssistant({
      pages: path.join(root, "pages"),
      output: root,
      baseUrl: "",
      configPath: undefined,
      chunkCharacters: 4000,
      publicConfig: { version: 1, title: "Ask", greeting: "Hi", model: { id: "x", label: "x", downloadMB: 1, memoryMB: 1 }, models: [{ id: "x", label: "x", downloadMB: 1, memoryMB: 1 }], retrieval: { maxChunks: 1, maxCharacters: 10 } }
    }), /must not overlap/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("published bin runs the compiled ESM CLI", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "smgen-assistant-bin-"));
  const pages = path.join(root, "pages");
  const output = path.join(root, "site");
  try {
    await mkdir(pages);
    await writeFile(path.join(pages, "index.md"), "# CLI page\n\nCLI body.\n");
    const bin = new URL("../bin/smgen-assistant.mjs", import.meta.url);
    const result = await execFileAsync(process.execPath, [bin.pathname, "build", "--pages", pages, "--output", output]);
    assert.match(result.stdout, /Built 1 pages and 1 chunks/u);
    assert.equal(JSON.parse(await readFile(path.join(output, "__smgen-assistant", "corpus.json"), "utf8")).sources.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("packed package installs a buildable CLI without a second WebLLM tree", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "smgen-assistant-package-"));
  const packages = path.join(root, "packages");
  const consumer = path.join(root, "consumer");
  const pages = path.join(consumer, "pages");
  const output = path.join(consumer, "site");
  try {
    await mkdir(packages);
    await mkdir(consumer);
    await mkdir(pages);
    await writeFile(path.join(consumer, "package.json"), "{\"private\":true}\n");
    await writeFile(path.join(pages, "index.md"), "# Packed page\n\nPacked body.\n");
    const packed = await execFileAsync("npm", [
      "pack",
      "--ignore-scripts",
      "--silent",
      "--pack-destination",
      packages
    ], { cwd: projectRoot });
    const archiveName = packed.stdout.trim().split(/\r?\n/u).at(-1);
    assert.ok(archiveName);
    await execFileAsync("npm", [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      path.join(packages, archiveName)
    ], { cwd: consumer });

    const bin = path.join(consumer, "node_modules", ".bin", "smgen-assistant");
    const result = await execFileAsync(bin, ["build", "--pages", pages, "--output", output]);
    assert.match(result.stdout, /Built 1 pages and 1 chunks/u);
    assert.equal(JSON.parse(await readFile(path.join(output, "__smgen-assistant", "corpus.json"), "utf8")).sources.length, 1);
    await assert.rejects(stat(path.join(consumer, "node_modules", "@mlc-ai")), { code: "ENOENT" });
    await assert.rejects(stat(path.join(consumer, "node_modules", "smgen-assistant", "eval")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
