// @ts-check

import assert from "node:assert/strict";
import test from "node:test";
import { sourceMatches } from "../eval/source-match.mjs";
import { summarizeRecords } from "../eval/metrics.mjs";

test("evaluation source matching accepts a deployed site base path", () => {
  assert.equal(sourceMatches("/smgen/index.html#create-a-site", "/index.html#create-a-site"), true);
  assert.equal(sourceMatches("https://example.test/docs/navigation.html#menus", "/navigation.html#menus"), true);
  assert.equal(sourceMatches("/smgen/index.html#smgen", "/index.html#create-a-site"), false);
  assert.equal(sourceMatches("/smgen/other.html#create-a-site", "/index.html#create-a-site"), false);
});

test("evaluation counts failures and separates retrieval modes", () => {
  const rows = summarizeRecords([
    { retrievalMode: "lexical", expectedSources: ["/guide#topic"], error: "search failed" },
    { retrievalMode: "lexical", expectedSources: ["/guide#topic"], telemetry: { retrievedSources: [{ url: "/guide#topic" }] } },
    { retrievalMode: "semantic", expectedSources: [], telemetry: { retrievedSources: [], rawAnswer: "", fallback: false, outcome: "no-sources" } }
  ]);
  assert.equal(rows[0]?.positives, 2);
  assert.equal(rows[0]?.retrieved, 1);
  assert.equal(rows[0]?.errors, 1);
  assert.equal(rows[1]?.abstained, 1);
  assert.equal(rows[1]?.generated, 0);
  assert.equal(rows[1]?.accepted, 0);
});
