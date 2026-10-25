// @ts-check

/** @typedef {import('./types.mjs').CorpusChunk} CorpusChunk */

const WORD = /[\p{L}\p{N}_./:+#-]+/gu;
const LOW_VALUE_TERMS = new Set([
  "a", "an", "and", "are", "do", "does", "explain", "for", "how", "i", "in", "is", "it", "me", "of", "on", "smgen", "tell", "the", "this", "through", "to", "use", "walk", "what", "with", "you", "your"
]);
const RELATED_TERMS = new Map([
  ["does", ["converts", "coordinates", "renders"]],
  ["make", ["create"]],
  ["making", ["create"]],
  ["configure", ["configuration", "settings"]],
  ["configured", ["configuration", "settings"]],
  ["configuring", ["configuration", "settings"]],
  ["website", ["site"]],
  ["websites", ["site"]],
  ["setup", ["install", "configure"]]
]);

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
 * Add conservative English suffix variants without discarding exact terms.
 *
 * @param {string} term
 */
function termVariants(term) {
  const variants = new Set([term, ...(RELATED_TERMS.get(term) ?? [])]);
  if (!/[_./:+#-]/u.test(term) && term.length > 4) {
    if (term.endsWith("ing")) {
      const base = term.slice(0, -3).replace(/(.)\1$/u, "$1");
      variants.add(base);
      variants.add(`${base}e`);
    }
    if (term.endsWith("ed")) {
      const base = term.slice(0, -2).replace(/(.)\1$/u, "$1");
      variants.add(base);
      variants.add(`${base}e`);
    }
    if (term.endsWith("es")) variants.add(term.slice(0, -2));
    else if (term.endsWith("s")) variants.add(term.slice(0, -1));
  }
  return [...variants].filter((variant) => variant.length > 1);
}

/**
 * Normalize directory URLs to the index document used in the corpus.
 *
 * @param {string} value
 */
function comparablePath(value) {
  const pathname = new URL(value, "https://smgen.invalid").pathname;
  return pathname.endsWith("/") ? `${pathname}index.html` : pathname;
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
 * @param {Array<{value: string, weight: number}>} terms
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
  for (const { value: term, weight } of terms) {
    const technical = /[_./:+#-]/u.test(term);
    score += Math.min(occurrences(title, term), 3) * (technical ? 12 : 8) * weight;
    score += Math.min(occurrences(heading, term), 3) * (technical ? 10 : 6) * weight;
    score += Math.min(occurrences(content, term), 6) * (technical ? 4 : 1.5) * weight;
  }
  if (/\b(?:begin|build|create|generate|make|start|use)\b/u.test(exact) && /\b(?:create a site|getting started|quick start)\b/u.test(`${title} ${heading}`)) {
    score += 36;
  }
  if (score > 0 && currentUrl && comparablePath(chunk.url) === comparablePath(currentUrl)) {
    score += 28;
  }
  return score;
}

/**
 * Weight query terms by their rarity across the corpus.
 *
 * @param {CorpusChunk[]} chunks
 * @param {string[]} queryTerms
 */
function weightedTerms(chunks, queryTerms) {
  const useful = queryTerms.filter((term) => !LOW_VALUE_TERMS.has(term));
  const base = useful.length ? useful : queryTerms;
  const variants = [...new Set(base.flatMap(termVariants))];
  return variants.map((value) => {
    const frequency = chunks.reduce((count, chunk) => {
      const searchable = normalized(`${chunk.title}\n${chunk.heading}\n${chunk.content}`);
      return count + Number(searchable.includes(value));
    }, 0);
    return { value, weight: Math.log((chunks.length + 1) / (frequency + 1)) + 1 };
  });
}

/**
 * Fit one candidate into the exact formatted character budget.
 *
 * @param {CorpusChunk[]} selected
 * @param {CorpusChunk} candidate
 * @param {number} maxCharacters
 */
function fitCandidate(selected, candidate, maxCharacters) {
  const full = [...selected, candidate];
  if (formatContext(full).length <= maxCharacters) return candidate;
  const empty = { ...candidate, content: "" };
  const available = maxCharacters - formatContext([...selected, empty]).length;
  if (available < 2) return null;
  const suffix = "…";
  const content = candidate.content.slice(0, Math.max(0, available - suffix.length)).trimEnd();
  if (!content) return null;
  return { ...candidate, content: `${content}${suffix}` };
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
  const queryTerms = tokenize(query);
  if (!queryTerms.length) return [];
  const terms = weightedTerms(chunks, queryTerms);
  const ranked = chunks
    .map((chunk, index) => ({ chunk, index, score: scoreChunk(chunk, query, terms, options.currentUrl ?? "") }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  /** @type {CorpusChunk[]} */
  const selected = [];
  const remaining = [...ranked];
  const sources = new Set();
  while (selected.length < options.maxChunks && remaining.length) {
    let index = 0;
    let best = -Infinity;
    for (let candidate = 0; candidate < remaining.length; candidate += 1) {
      const item = remaining[candidate];
      if (!item) continue;
      const adjusted = item.score + (sources.has(item.chunk.sourceId) ? 0 : 12);
      if (adjusted > best) {
        best = adjusted;
        index = candidate;
      }
    }
    const [item] = remaining.splice(index, 1);
    if (!item) break;
    const fitted = fitCandidate(selected, item.chunk, options.maxCharacters);
    if (!fitted) continue;
    selected.push(fitted);
    sources.add(item.chunk.sourceId);
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
