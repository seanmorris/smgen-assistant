// @ts-check

import { Document } from "@langchain/core/documents";
import { Embeddings } from "@langchain/core/embeddings";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { SEMANTIC_CANDIDATES } from "./hybrid-retrieval.mjs";

/** @typedef {import('./types.mjs').CorpusChunk} CorpusChunk */
/** @typedef {import('@langchain/core/embeddings').EmbeddingsInterface} EmbeddingsInterface */
/** @typedef {{version: 1, embedding: typeof EMBEDDING, fingerprint: string, ids: string[], vectors: number[][]}} SemanticIndex */

export const EMBEDDING = /** @type {const} */ ({
  runtimeVersion: "4.3.2",
  documentFormat: 1,
  model: "Xenova/all-MiniLM-L6-v2",
  revision: "751bff37182d3f1213fa05d7196b954e230abad9",
  dtype: "q8",
  dimensions: 384,
  pooling: "mean",
  normalize: true
});

/** Run the same pinned embedding model at build time and inside a browser worker. */
export class LocalEmbeddings extends Embeddings {
  /**
   * Configure local inference; no inference requests or tracing leave this process.
   * @param {{wasmPaths?: string, onProgress?: (message: string) => void}} [options]
   */
  constructor(options = {}) {
    super({ maxConcurrency: 1, maxRetries: 0 });
    this.options = options;
    /** @type {Promise<import('@huggingface/transformers').FeatureExtractionPipeline> | null} */
    this.pipelinePromise = null;
  }

  /** Load the tokenizer and quantized model once per worker or build. */
  async getPipeline() {
    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        const { env, pipeline } = await import("@huggingface/transformers");
        env.allowLocalModels = false;
        if (env.backends.onnx.wasm) {
          env.backends.onnx.wasm.numThreads = 1;
          if (this.options.wasmPaths) env.backends.onnx.wasm.wasmPaths = {
            mjs: new URL("ort-wasm-simd-threaded.mjs", this.options.wasmPaths).href,
            wasm: new URL("ort-wasm-simd-threaded.wasm", this.options.wasmPaths).href
          };
        }
        this.options.onProgress?.("Loading local search model…");
        return pipeline("feature-extraction", EMBEDDING.model, {
          revision: EMBEDDING.revision,
          dtype: EMBEDDING.dtype,
          device: typeof window === "undefined" && typeof process !== "undefined" && process.versions?.node ? "cpu" : "wasm",
          session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
          progress_callback: (progress) => {
            if (progress.status === "progress") this.options.onProgress?.(`Loading local search model… ${Math.round(progress.progress)}%`);
          }
        });
      })().catch((error) => { this.pipelinePromise = null; throw error; });
    }
    return this.pipelinePromise;
  }

  /** Embed batches sequentially to keep build and browser memory bounded. @param {string[]} texts */
  async embedDocuments(texts) {
    if (!texts.length) return [];
    const pipe = await this.getPipeline();
    /** @type {number[][]} */
    const vectors = [];
    for (let offset = 0; offset < texts.length; offset += 8) {
      const output = await pipe(texts.slice(offset, offset + 8), { pooling: EMBEDDING.pooling, normalize: true });
      vectors.push(.../** @type {number[][]} */ (output.tolist()));
    }
    return vectors;
  }

  /** Embed a visitor's question locally. @param {string} text */
  async embedQuery(text) {
    const [vector] = await this.embedDocuments([text]);
    if (!vector) throw new Error("The local search model returned no embedding.");
    return vector;
  }

  /** Release native model resources after a build or evaluation finishes. */
  async dispose() {
    const pending = this.pipelinePromise;
    this.pipelinePromise = null;
    if (pending) await (await pending).dispose();
  }
}

/** Include section metadata in embeddings while retaining the original source text. @param {CorpusChunk} chunk */
function documentText(chunk) {
  return [chunk.title, chunk.heading, ...(chunk.keywords ?? []), chunk.content].join("\n");
}

/** Bind an index to exact chunk contents, metadata, order, and model settings. @param {CorpusChunk[]} chunks */
async function fingerprint(chunks) {
  const bytes = new TextEncoder().encode(JSON.stringify({ embedding: EMBEDDING, chunks }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Compute document vectors once while generating the static site.
 * @param {CorpusChunk[]} chunks
 * @param {EmbeddingsInterface} embeddings
 * @returns {Promise<SemanticIndex>}
 */
export async function buildSemanticIndex(chunks, embeddings) {
  const index = {
    version: /** @type {const} */ (1),
    embedding: EMBEDDING,
    fingerprint: await fingerprint(chunks),
    ids: chunks.map(({ id }) => id),
    vectors: await embeddings.embedDocuments(chunks.map(documentText))
  };
  await validateSemanticIndex(index, chunks);
  return index;
}

/**
 * Reject mismatched models, stale corpora, and invalid vectors before search.
 * @param {SemanticIndex} index
 * @param {CorpusChunk[]} chunks
 */
export async function validateSemanticIndex(index, chunks) {
  if (index?.version !== 1 || JSON.stringify(index.embedding) !== JSON.stringify(EMBEDDING)) {
    throw new Error("The semantic index uses an incompatible embedding model. Rebuild the assistant.");
  }
  if (index.fingerprint !== await fingerprint(chunks) || !Array.isArray(index.ids)
    || index.ids.length !== chunks.length || index.ids.some((id, position) => id !== chunks[position]?.id)
    || new Set(index.ids).size !== index.ids.length) {
    throw new Error("The semantic index does not match this corpus. Rebuild the assistant.");
  }
  if (!Array.isArray(index.vectors) || index.vectors.length !== chunks.length
    || index.vectors.some((vector) => !Array.isArray(vector) || vector.length !== EMBEDDING.dimensions
      || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))
      || !vector.some((value) => value !== 0))) {
    throw new Error("The semantic index contains invalid vectors. Rebuild the assistant.");
  }
}

/**
 * Load precomputed vectors into LangChain without re-embedding the corpus.
 * @param {CorpusChunk[]} chunks
 * @param {SemanticIndex} index
 * @param {EmbeddingsInterface} embeddings
 */
export async function createSemanticSearch(chunks, index, embeddings) {
  await validateSemanticIndex(index, chunks);
  const store = new MemoryVectorStore(embeddings);
  await store.addVectors(index.vectors, chunks.map((chunk) => new Document({
    id: chunk.id, pageContent: chunk.content, metadata: { chunkId: chunk.id }
  })));
  return async (/** @type {string} */ query) => {
    const results = await store.similaritySearchWithScore(query, SEMANTIC_CANDIDATES);
    return results.map(([document, score]) => ({ id: /** @type {string} */ (document.metadata.chunkId), score }));
  };
}
