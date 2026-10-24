// @ts-check

import assert from "node:assert/strict";
import test from "node:test";
import { formatContext, retrieveChunks, tokenize } from "../src/shared/retrieval.mjs";

const chunks = [
  { id: "1", sourceId: "a", title: "Install", heading: "Install package", url: "/install.html", content: "Run npm install sample." },
  { id: "2", sourceId: "b", title: "PHP API", heading: "PhpCgiNode", url: "/api.html", content: "Call php.request() with a document root." },
  { id: "3", sourceId: "c", title: "Other", heading: "Overview", url: "/other.html", content: "General background material." }
];

test("tokenizer preserves technical identifiers", () => {
  assert.deepEqual(tokenize("PhpCgiNode php.request() foo-bar"), ["phpcginode", "php.request", "foo-bar"]);
});

test("retrieval boosts identifiers and the current page", () => {
  const selected = retrieveChunks(chunks, "How do I call php.request?", {
    maxChunks: 2,
    maxCharacters: 1000,
    currentUrl: "https://example.test/api.html"
  });
  assert.equal(selected[0]?.id, "2");
  assert.equal(selected.length, 1);
  assert.match(formatContext(selected), /\[Source 1\][\s\S]*\/api\.html/u);
});

test("retrieval enforces the character and result budgets", () => {
  const selected = retrieveChunks(chunks, "package general", { maxChunks: 1, maxCharacters: 30 });
  assert.equal(selected.length, 1);
});
