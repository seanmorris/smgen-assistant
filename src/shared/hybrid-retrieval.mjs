// @ts-check

import { fitRankedChunks, rankLexicalChunks, retrieveChunks } from "./retrieval.mjs";

/** @typedef {import('./types.mjs').CorpusChunk} CorpusChunk */
/** @typedef {import('./retrieval.mjs').RetrievalOptions} RetrievalOptions */
/** @typedef {'lexical' | 'semantic' | 'hybrid'} RetrievalMode */
/** @typedef {{id: string, score: number}} SemanticHit */

export const RETRIEVAL_MODES = /** @type {const} */ (["lexical", "semantic", "hybrid"]);
export const SEMANTIC_CANDIDATES = 10;
export const MIN_QUERY_SIMILARITY = 0.2;
export const MIN_CANDIDATE_SIMILARITY = 0.18;
export const SEMANTIC_WEIGHT = 0.65;
export const RRF_CONSTANT = 5;

/**
 * Resolve the configured mode, permitting URL overrides only in evaluation mode.
 *
 * @param {string | undefined} configured
 * @param {URLSearchParams} parameters
 * @returns {RetrievalMode}
 */
export function retrievalMode(configured, parameters) {
  const requested = parameters.get("evaluation") === "1" ? parameters.get("retrieval") : null;
  const mode = requested ?? configured ?? "lexical";
  if (!RETRIEVAL_MODES.some((candidate) => candidate === mode)) throw new Error(`Unknown retrieval mode: ${mode}`);
  return /** @type {RetrievalMode} */ (mode);
}

/**
 * Combine lexical and semantic ranks without comparing their incompatible scores.
 * Semantic-only searches retain their cosine ordering. The lexical baseline is unchanged.
 *
 * @param {CorpusChunk[]} chunks
 * @param {string} query
 * @param {RetrievalOptions} options
 * @param {RetrievalMode} mode
 * @param {SemanticHit[]} [hits]
 */
export function selectRetrievedChunks(chunks, query, options, mode, hits = []) {
  if (mode === "lexical") return retrieveChunks(chunks, query, options);
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const candidates = hits.filter((hit) => byId.has(hit.id) && Number.isFinite(hit.score))
    .sort((a, b) => b.score - a.score).slice(0, SEMANTIC_CANDIDATES);
  const semantic = (candidates[0]?.score ?? 0) >= MIN_QUERY_SIMILARITY
    ? candidates.filter((hit) => hit.score >= MIN_CANDIDATE_SIMILARITY)
    : [];
  /** @type {Map<string, number>} */
  const scores = new Map();
  semantic.forEach((hit, rank) => scores.set(hit.id, SEMANTIC_WEIGHT / (RRF_CONSTANT + rank + 1)));
  if (mode === "hybrid") {
    rankLexicalChunks(chunks, query, options).slice(0, SEMANTIC_CANDIDATES).forEach(({ chunk }, rank) => {
      scores.set(chunk.id, (scores.get(chunk.id) ?? 0) + (1 - SEMANTIC_WEIGHT) / (RRF_CONSTANT + rank + 1));
    });
  }
  const ranked = [...scores].sort((a, b) => b[1] - a[1]).map(([id]) => byId.get(id)).filter((chunk) => chunk !== undefined);
  return fitRankedChunks(ranked, query, options);
}
