// @ts-check

/** @typedef {import('./types.mjs').CorpusChunk} CorpusChunk */

const WORD = /[\p{L}\p{N}_./:+#-]+/gu;

/**
 * Normalize text for case-insensitive local matching.
 *
 * @param {string} value
 */
function normalized(value) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

/**
 * Extract searchable words while retaining common identifier punctuation.
 *
 * @param {string} value
 */
export function tokenize(value) {
  return (normalized(value).match(WORD) ?? []).filter((term) => term.length > 1 || /[_./:+#-]/u.test(term));
}

/**
 * Count non-overlapping appearances of one string inside another.
 *
 * @param {string} haystack
 * @param {string} needle
 */
function occurrences(haystack, needle) {
  let count = 0;
  let offset = 0;
  while (needle && (offset = haystack.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

/**
 * Score one corpus chunk against a query and current page.
 *
 * @param {CorpusChunk} chunk
 * @param {string} query
 * @param {string[]} terms
 * @param {string} currentUrl
 */
function scoreChunk(chunk, query, terms, currentUrl) {
  const title = normalized(chunk.title);
  const heading = normalized(chunk.heading);
  const content = normalized(chunk.content);
  const exact = normalized(query.trim());
  let score = 0;
  if (exact.length > 2) {
    if (title.includes(exact)) score += 35;
    if (heading.includes(exact)) score += 25;
    if (content.includes(exact)) score += 14;
  }
  const distinct = [...new Set(terms)];
  for (const term of distinct) {
    const technical = /[_./:+#-]/u.test(term);
    score += Math.min(occurrences(title, term), 3) * (technical ? 12 : 8);
    score += Math.min(occurrences(heading, term), 3) * (technical ? 10 : 6);
    score += Math.min(occurrences(content, term), 6) * (technical ? 4 : 1.5);
  }
  if (currentUrl && new URL(chunk.url, "https://smgen.invalid").pathname === new URL(currentUrl, "https://smgen.invalid").pathname) {
    score += 10;
  }
  return score;
}

/**
 * @typedef {object} RetrievalOptions
 * @property {number} maxChunks
 * @property {number} maxCharacters
 * @property {string} [currentUrl]
 */

/**
 * Select the highest-scoring chunks within result and character budgets.
 *
 * @param {CorpusChunk[]} chunks
 * @param {string} query
 * @param {RetrievalOptions} options
 * @returns {CorpusChunk[]}
 */
export function retrieveChunks(chunks, query, options) {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const ranked = chunks
    .map((chunk, index) => ({ chunk, index, score: scoreChunk(chunk, query, terms, options.currentUrl ?? "") }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  /** @type {CorpusChunk[]} */
  const selected = [];
  let characters = 0;
  for (const item of ranked) {
    if (selected.length >= options.maxChunks) break;
    const cost = item.chunk.title.length + item.chunk.heading.length + item.chunk.content.length + 32;
    if (selected.length && characters + cost > options.maxCharacters) continue;
    selected.push(item.chunk);
    characters += cost;
  }
  return selected;
}

/**
 * Format retrieved chunks as numbered context blocks for the model.
 *
 * @param {CorpusChunk[]} chunks
 */
export function formatContext(chunks) {
  return chunks.map((chunk, index) => [
    `[Source ${index + 1}]`,
    `Title: ${chunk.title}`,
    `Section: ${chunk.heading}`,
    `URL: ${chunk.url}`,
    chunk.content
  ].join("\n")).join("\n\n");
}
