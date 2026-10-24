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
  const maxCharacters = 90;
  const selected = retrieveChunks(chunks, "package general", { maxChunks: 1, maxCharacters });
  assert.equal(selected.length, 1);
  assert.ok(formatContext(selected).length <= maxCharacters);
  assert.match(selected[0]?.content ?? "", /…$/u);
});

test("retrieval does not return an unrelated current page", () => {
  const selected = retrieveChunks(chunks, "xyzzynotfound", {
    maxChunks: 2,
    maxCharacters: 1000,
    currentUrl: "https://example.test/api.html"
  });
  assert.deepEqual(selected, []);
});

test("retrieval favors build instructions and varied source pages", () => {
  const pages = [
    { id: "start", sourceId: "start", title: "Getting Started", heading: "Create a Site", url: "/index.html#create-a-site", content: "Build a site by running ./smgen.sh build after writing Markdown pages." },
    { id: "deploy", sourceId: "deploy", title: "Deployment", heading: "GitHub Pages", url: "/deployment.html#github-pages", content: "Build and publish the generated site with GitHub Actions." },
    { id: "more", sourceId: "start", title: "Getting Started", heading: "Requirements", url: "/index.html#requirements", content: "Building needs PHP and Composer." }
  ];
  const selected = retrieveChunks(pages, "Walk me through building a site with SMGen", {
    maxChunks: 3,
    maxCharacters: 1000,
    currentUrl: "/index.html"
  });
  assert.equal(selected[0]?.id, "start");
  assert.equal(new Set(selected.map((chunk) => chunk.sourceId)).size, 2);
});
