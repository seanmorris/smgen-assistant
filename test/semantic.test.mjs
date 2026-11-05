// @ts-check

import assert from "node:assert/strict";
import test from "node:test";
import { buildSemanticIndex, createSemanticSearch, EMBEDDING, validateSemanticIndex } from "../src/shared/semantic.mjs";
import { selectRetrievedChunks, retrievalMode } from "../src/shared/hybrid-retrieval.mjs";
import { formatContext, retrieveChunks } from "../src/shared/retrieval.mjs";

const chunks = [
  { id: "greeting", sourceId: "settings", title: "Settings", heading: "Greeting", url: "/settings#greeting", content: "Set `greeting` to change the introductory text." },
  { id: "privacy", sourceId: "privacy", title: "Privacy", heading: "Private questions", url: "/privacy#questions", content: "Questions remain on the visitor's device." }
];
const options = { maxChunks: 2, maxCharacters: 1000 };
/** @param {number} axis */
function vector(axis) { return Array.from({ length: EMBEDDING.dimensions }, (_, index) => Number(index === axis)); }
const embeddings = {
  embedDocuments: async () => [vector(0), vector(1)],
  embedQuery: async () => vector(0)
};

test("a restored LangChain index searches without re-embedding documents", async () => {
  const index = await buildSemanticIndex(chunks, embeddings);
  const search = await createSemanticSearch(chunks, index, {
    embedDocuments: async () => { throw new Error("Document vectors should come from the build"); },
    embedQuery: embeddings.embedQuery
  });
  const question = "Customize the welcome message";
  assert.deepEqual(retrieveChunks(chunks, question, options), []);
  const selected = selectRetrievedChunks(chunks, question, options, "semantic", await search(question));
  assert.equal(selected[0]?.url, "/settings#greeting");
  assert.equal(selected[0]?.content, chunks[0]?.content);
});

test("semantic indexes reject changed sources, model settings, IDs, and malformed vectors", async () => {
  const index = await buildSemanticIndex(chunks, embeddings);
  await assert.rejects(validateSemanticIndex(index, chunks.map((chunk) => ({ ...chunk, content: `${chunk.content} updated` }))), /does not match/u);
  const wrongModel = structuredClone(index);
  Object.assign(wrongModel.embedding, { revision: "different" });
  await assert.rejects(validateSemanticIndex(wrongModel, chunks), /incompatible/u);
  await assert.rejects(validateSemanticIndex({ ...index, ids: [...index.ids].reverse() }, chunks), /does not match/u);
  for (const invalid of [[1], Array(384).fill(0), [...vector(0).slice(1), NaN]]) {
    await assert.rejects(validateSemanticIndex({ ...index, vectors: [invalid, vector(1)] }, chunks), /invalid vectors/u);
  }
});

test("hybrid retrieval retains identifiers, rejects weak semantic hits, and fits budgets", () => {
  const hits = [{ id: "privacy", score: 0.1 }, { id: "unknown", score: 1 }];
  assert.deepEqual(selectRetrievedChunks(chunks, "nonsense", options, "semantic", hits), []);
  const selected = selectRetrievedChunks(chunks, "greeting", { ...options, maxCharacters: 95 }, "hybrid", hits);
  assert.equal(selected[0]?.id, "greeting");
  assert.ok(formatContext(selected).length <= 95);
  assert.deepEqual(selectRetrievedChunks(chunks, "greeting", options, "lexical", hits), retrieveChunks(chunks, "greeting", options));
});

test("only evaluation frames accept URL retrieval overrides", () => {
  assert.equal(retrievalMode(undefined, new URLSearchParams("retrieval=semantic")), "lexical");
  assert.equal(retrievalMode("hybrid", new URLSearchParams("evaluation=1&retrieval=lexical")), "lexical");
  assert.throws(() => retrievalMode("hybrid", new URLSearchParams("evaluation=1&retrieval=typo")), /Unknown/u);
});
