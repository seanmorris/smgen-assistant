// @ts-check

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG, normalizeBaseUrl, parseBuildOptions } from "../src/cli/config.mjs";

test("the default model matches the documented Qwen build", () => {
  assert.equal(DEFAULT_CONFIG.model.id, "Qwen2.5-1.5B-Instruct-q4f32_1-MLC");
  assert.equal(DEFAULT_CONFIG.model.downloadMB, 880);
  assert.equal(DEFAULT_CONFIG.model.memoryMB, 1889);
  assert.deepEqual(DEFAULT_CONFIG.retrieval, { maxChunks: 2, maxCharacters: 3000 });
});

test("normalizeBaseUrl accepts empty and nested site paths", () => {
  assert.equal(normalizeBaseUrl(""), "");
  assert.equal(normalizeBaseUrl("/docs/project/"), "/docs/project");
  assert.equal(normalizeBaseUrl("https://example.test/docs/"), "/docs");
  assert.throws(() => normalizeBaseUrl("/docs?preview=1"), /query string/u);
  assert.throws(() => normalizeBaseUrl("/docs/../private"), /dot segments/u);
});

test("command flags override YAML and environment defaults", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "smgen-assistant-config-"));
  try {
    await writeFile(path.join(directory, "assistant.yaml"), [
      "title: Project help",
      "baseUrl: /from-file",
      "model:",
      "  label: Small model",
      "retrieval:",
      "  maxChunks: 4",
      ""
    ].join("\n"));
    const parsed = await parseBuildOptions([
      "build", "--config", "assistant.yaml", "--base-url", "/from-flag"
    ], { BASE_URL: "/from-env" }, directory);
    assert.equal(parsed.help, false);
    if (parsed.help) return;
    assert.equal(parsed.config.baseUrl, "/from-flag");
    assert.equal(parsed.config.publicConfig.title, "Project help");
    assert.equal(parsed.config.publicConfig.model.label, "Small model");
    assert.deepEqual(parsed.config.publicConfig.models, [parsed.config.publicConfig.model]);
    assert.equal(parsed.config.publicConfig.retrieval.maxChunks, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a model list preserves order and optional resource estimates", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "smgen-assistant-models-"));
  try {
    await writeFile(path.join(directory, ".smgen-assistant.yaml"), [
      "models:",
      "  - id: small-model",
      "    label: Small",
      "    downloadMB: 300",
      "    memoryMB: 1000",
      "    quality: 10",
      "    requiredFeatures: [shader-f16]",
      "    minStorageBufferMB: 256",
      "    minDeviceMemoryGB: 16",
      "  - id: larger-model",
      "",
    ].join("\n"));
    const parsed = await parseBuildOptions(["build"], {}, directory);
    assert.equal(parsed.help, false);
    if (parsed.help) return;
    assert.deepEqual(parsed.config.publicConfig.models, [
      {
        id: "small-model",
        label: "Small",
        downloadMB: 300,
        memoryMB: 1000,
        quality: 10,
        requiredFeatures: ["shader-f16"],
        minStorageBufferMB: 256,
        minDeviceMemoryGB: 16
      },
      { id: "larger-model", label: "larger-model" }
    ]);
    assert.deepEqual(parsed.config.publicConfig.model, parsed.config.publicConfig.models[0]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("model configuration rejects ambiguous and duplicate choices", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "smgen-assistant-model-errors-"));
  try {
    const filename = path.join(directory, ".smgen-assistant.yaml");
    await writeFile(filename, "model: {}\nmodels: []\n");
    await assert.rejects(parseBuildOptions(["build"], {}, directory), /either model or models/u);
    await writeFile(filename, "models:\n  - id: same\n  - id: same\n");
    await assert.rejects(parseBuildOptions(["build"], {}, directory), /duplicate IDs/u);
    await writeFile(filename, "models:\n  - id: model\n    requiredFeatures: []\n");
    await assert.rejects(parseBuildOptions(["build"], {}, directory), /nonempty sequence/u);
    await writeFile(filename, "models:\n  - id: model\n    quality: 0\n");
    await assert.rejects(parseBuildOptions(["build"], {}, directory), /positive integer/u);
    await writeFile(filename, "models:\n  - id: model\n    minDeviceMemoryGB: 0\n");
    await assert.rejects(parseBuildOptions(["build"], {}, directory), /positive integer/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an explicit empty base URL overrides the environment for a root site", async () => {
  const parsed = await parseBuildOptions([
    "build", "--pages", "./pages", "--output", "./docs", "--base-url", ""
  ], { BASE_URL: "/from-env" }, "/project");
  assert.equal(parsed.help, false);
  if (!parsed.help) assert.equal(parsed.config.baseUrl, "");
});

test("SMGen finalize context supplies staged build paths", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "smgen-assistant-plugin-"));
  try {
    const contextPath = path.join(directory, "context.json");
    await writeFile(path.join(directory, "assistant.yaml"), "title: Plugin assistant\n");
    await writeFile(contextPath, JSON.stringify({
      apiVersion: "smgen/v1",
      phase: "finalize",
      project: { root: directory },
      plugin: { options: { config: "assistant.yaml" } },
      paths: {
        pages: path.join(directory, "pages"),
        stage: path.join(directory, "stage"),
        pageManifest: path.join(directory, "pages.tsv")
      },
      site: { baseUrl: "/manual" }
    }));
    const parsed = await parseBuildOptions(["build", "--smgen-context"], {
      SMGEN_PLUGIN_CONTEXT: contextPath
    }, "/ignored");
    assert.equal(parsed.help, false);
    if (parsed.help) return;
    assert.equal(parsed.config.pages, path.join(directory, "pages"));
    assert.equal(parsed.config.output, path.join(directory, "stage"));
    assert.equal(parsed.config.baseUrl, "/manual");
    assert.equal(parsed.config.pageManifest, path.join(directory, "pages.tsv"));
    assert.equal(parsed.config.publicConfig.title, "Plugin assistant");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
