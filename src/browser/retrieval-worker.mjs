// @ts-check

import { createSemanticSearch, LocalEmbeddings } from "../shared/semantic.mjs";

const scope = /** @type {DedicatedWorkerGlobalScope} */ (/** @type {unknown} */ (self));
/** @type {Promise<{search: Awaited<ReturnType<typeof createSemanticSearch>>, indexBytes: number}> | null} */
let ready = null;

/**
 * Load this site's corpus and index once; weights are fetched only for the first question.
 * @param {string} assetBase
 * @param {string} requestId
 */
async function initialize(assetBase, requestId) {
  const base = new URL(assetBase);
  if (base.origin !== scope.location.origin) throw new Error("Search assets must use the assistant's origin.");
  const responses = await Promise.all(["corpus.json", "semantic-index.json"].map((name) =>
    fetch(new URL(name, base), { cache: "no-cache", credentials: "same-origin" })
  ));
  if (responses.some((response) => !response.ok)) throw new Error("Search assets are unavailable. Rebuild with retrieval.mode: hybrid.");
  const corpus = /** @type {import('../shared/types.mjs').Corpus} */ (await responses[0]?.json());
  const indexText = await responses[1]?.text();
  if (!indexText) throw new Error("The semantic index is empty.");
  const embeddings = new LocalEmbeddings({
    wasmPaths: new URL("onnx/", base).href,
    onProgress: (message) => scope.postMessage({ id: requestId, type: "progress", message })
  });
  return { search: await createSemanticSearch(corpus.chunks, JSON.parse(indexText), embeddings), indexBytes: new TextEncoder().encode(indexText).length };
}

scope.addEventListener("message", async (event) => {
  const { id, query, assetBase } = event.data;
  if (typeof id !== "string" || typeof query !== "string" || typeof assetBase !== "string") return;
  const cold = !ready;
  try {
    ready ??= initialize(assetBase, id);
    const { search, indexBytes } = await ready;
    const hits = await search(query);
    scope.postMessage({ id, type: "result", hits, cold, indexBytes });
  } catch (error) {
    ready = null;
    scope.postMessage({ id, type: "error", message: error instanceof Error ? error.message : String(error) });
  }
});
