// @ts-check

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeBaseUrl, parseBuildOptions } from "../src/cli/config.mjs";

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
    assert.equal(parsed.config.publicConfig.retrieval.maxChunks, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
