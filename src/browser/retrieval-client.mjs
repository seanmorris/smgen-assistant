// @ts-check

import { selectRetrievedChunks } from "../shared/hybrid-retrieval.mjs";

/** @typedef {import('../shared/hybrid-retrieval.mjs').RetrievalMode} RetrievalMode */
/** @typedef {import('../shared/hybrid-retrieval.mjs').SemanticHit} SemanticHit */
/** @typedef {{hits: SemanticHit[], cold: boolean, indexBytes: number}} WorkerResult */

/** Keep semantic inference outside the page and load it only when selected. */
export class RetrievalClient {
  /** Configure worker assets. @param {URL} assetBase */
  constructor(assetBase) {
    this.assetBase = assetBase;
    /** @type {Worker | null} */
    this.worker = null;
  }

  /**
   * Search precomputed vectors using a local query embedding, with cancellation.
   * @param {string} query
   * @param {AbortSignal} signal
   * @param {(message: string) => void} onProgress
   * @returns {Promise<WorkerResult>}
   */
  search(query, signal, onProgress) {
    signal.throwIfAborted();
    if (!globalThis.crypto?.subtle || !globalThis.crypto?.randomUUID) throw new Error("Local search requires HTTPS or a localhost URL.");
    this.worker ??= new Worker(new URL("retrieval-worker.js", this.assetBase), { type: "module", name: "smgen-search" });
    const worker = this.worker;
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      /** Remove handlers when the request settles. */
      const cleanup = () => {
        signal.removeEventListener("abort", abort);
        worker.removeEventListener("message", message);
        worker.removeEventListener("error", failure);
        clearTimeout(timeout);
      };
      /** Terminate failed or cancelled inference so it cannot keep consuming resources. @param {Error} error */
      const stop = (error) => {
        cleanup();
        worker.terminate();
        this.worker = null;
        reject(error);
      };
      /** Cancel downloads and inference by disposing the dedicated worker. */
      const abort = () => stop(new DOMException("Search stopped.", "AbortError"));
      /** Reject worker import and runtime failures. @param {ErrorEvent} event */
      const failure = (event) => stop(new Error(event.message || "The local search worker failed."));
      /** Receive search results and model-loading progress. @param {MessageEvent} event */
      const message = (event) => {
        if (event.data?.id !== id) return;
        if (event.data.type === "progress") onProgress(event.data.message);
        if (event.data.type === "error") stop(new Error(event.data.message));
        if (event.data.type === "result") { cleanup(); resolve(event.data); }
      };
      const timeout = setTimeout(() => stop(new Error("Local search timed out while loading or running the embedding model.")), 180_000);
      signal.addEventListener("abort", abort, { once: true });
      worker.addEventListener("message", message);
      worker.addEventListener("error", failure);
      worker.postMessage({ id, query, assetBase: this.assetBase.href });
    });
  }

  /**
   * Run one retrieval mode while preserving the existing source and prompt contracts.
   * @param {import('../shared/types.mjs').CorpusChunk[]} chunks
   * @param {string} query
   * @param {import('../shared/retrieval.mjs').RetrievalOptions} options
   * @param {RetrievalMode} mode
   * @param {AbortSignal} signal
   * @param {(message: string) => void} [onProgress]
   */
  async retrieve(chunks, query, options, mode, signal, onProgress = () => {}) {
    const startedAt = performance.now();
    const result = mode === "lexical" ? { hits: [], cold: false, indexBytes: 0 }
      : await this.search(options.previousQuery ? `${options.previousQuery} ${query}` : query, signal, onProgress);
    signal.throwIfAborted();
    return {
      chunks: selectRetrievedChunks(chunks, query, options, mode, result.hits),
      telemetry: { mode, milliseconds: Math.round(performance.now() - startedAt), cold: result.cold, indexBytes: result.indexBytes, semanticCandidates: result.hits }
    };
  }
}
