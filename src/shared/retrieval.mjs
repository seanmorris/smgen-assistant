// @ts-check

import { questionIntents } from "./intent.mjs";

/** @typedef {import('./types.mjs').CorpusChunk} CorpusChunk */

const WORD = /[\p{L}\p{N}_./:+#-]+/gu;
const LOW_VALUE_TERMS = new Set([
  "a", "an", "and", "are", "do", "does", "explain", "for", "how", "i", "in", "is", "it", "me", "of", "on", "smgen", "tell", "the", "thing", "this", "through", "to", "use", "walk", "what", "why", "with", "would", "you", "your"
]);
const RELATED_TERMS = new Map([
  ["assets", ["css", "javascript", "script", "stylesheet"]],
  ["browser", ["css", "javascript", "script", "stylesheet"]],
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
const MAX_SOURCE_CHARACTERS = 1200;
const STRONG_INTENT_RELEVANCE = 14;
const INTENT_MATCH_BOOST = 12;

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
  return (normalized(value).match(WORD) ?? [])
    .map((term) => term.replace(/[.:]+$/u, ""))
    .filter((term) => term.length > 1 || /[_./:+#-]/u.test(term));
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
 * @param {string[]} intents
 * @returns {{score: number, strongIntentMatch: boolean}}
 */
function scoreChunk(chunk, query, terms, currentUrl, intents) {
  const title = normalized(chunk.title);
  const heading = normalized(chunk.heading);
  const content = normalized(chunk.content);
  const keywords = normalized(chunk.keywords?.join(" ") ?? "");
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
    score += Math.min(occurrences(keywords, term), 3) * (technical ? 12 : 8) * weight;
    score += Math.min(occurrences(content, term), 6) * (technical ? 4 : 1.5) * weight;
  }
  if (/\b(?:begin|build|create|generate|make|start)\b/u.test(exact) && /\b(?:create a site|getting started|quick start)\b/u.test(`${title} ${heading}`)) {
    score += 36;
  }
  if (/\b(?:from (?:nothing|scratch)|first (?:local )?(?:page|site)|empty (?:directory|folder))\b/u.test(exact) && /\b(?:create a site|smgen init)\b/u.test(`${title} ${heading}`)) {
    score += 48;
  }
  if (/\b(?:what is|what does|what.*for|why (?:use|would)|tell me about)\b/u.test(exact) && /^(?:smgen|overview|introduction)$/u.test(heading)) {
    score += 48;
  }
  if (/\b(?:where|which).*(?:put|store|write).*(?:content|page|pages|words)\b/u.test(exact) && /(?:^| > )writing pages$/u.test(heading)) {
    score += 48;
  }
  if (/\bwhere\b.*\b(?:publish|output|url|end up)\b/u.test(exact) && /(?:\.md\b|markdown|page)/u.test(exact) && /(?:^| > )writing pages$/u.test(heading)) {
    score += 80;
  }
  if (/\b(?:add|another|create|custom|make|new).*(?:menu|navigation)\b/u.test(exact) && /define menus and regions$/u.test(heading)) {
    score += 48;
  }
  if (/(?:\b(?:choose|select)\b.*\bpages?\b|\bpages?\b.*\b(?:belong|membership|opt (?:in|out))\b)/u.test(exact) && /select menus from pages$/u.test(heading)) {
    score += 80;
  }
  if (/\b(?:add|another|create|custom|make|new).*(?:menu|navigation)\b/u.test(exact) && /(?:\b(?:choose|select)\b.*\bpages?\b|\bpages?\b.*\b(?:belong|membership|opt (?:in|out))\b)/u.test(exact) && /define menus and regions$/u.test(heading)) {
    score += 80;
  }
  if (/\b(?:css|javascript|stylesheet|scripts?|static)\b/u.test(exact) && /\b(?:add|custom|load|own|publish|watch)\b/u.test(exact) && /add styles and scripts$/u.test(heading)) {
    score += 64;
  }
  if (/\b(?:layout|template)\b/u.test(exact) && /\b(?:custom|different|one page|page|php)\b/u.test(exact) && /write a page template$/u.test(heading)) {
    score += 80;
  }
  if (/\b(?:plugin|bulk|include|exclude|selector|where)\b/u.test(exact) && /menu plugins$/u.test(heading)) {
    score += 80;
  }
  if (/\b(?:archive|blogger|timeline)\b/u.test(exact) && /\b(?:calendar|date|month|year)\b/u.test(exact) && /timeline menus$/u.test(heading)) {
    score += 80;
  }
  if (/\b(?:rss|feeds?)\b/u.test(exact) && /\b(?:article|frontmatter|membership|page|publish|releases?)\b/u.test(exact) && /select pages$/u.test(heading)) {
    score += 96;
  }
  if (/\b(?:rss|feeds?)\b/u.test(exact) && /\b(?:created|date|timestamp|without)\b/u.test(exact) && /dates and item data$/u.test(heading)) {
    score += 96;
  }
  if (/\b(?:frontmatter|metadata|title|yaml)\b/u.test(exact) && /page frontmatter$/u.test(heading)) {
    score += 64;
  }
  if (/(?:\bbase_url\b|\bsubdirectory\b.*\b(?:build|deploy|github pages|links?|public)\b)/u.test(exact) && /set the public url$/u.test(heading)) {
    score += 72;
  }
  if (/\b(?:override|beats?|wins?|precedence|order)\b/u.test(exact) && /\b(?:config(?:uration)?|environment|shell|yaml)\b/u.test(exact) && /precedence$/u.test(heading)) {
    score += 64;
  }
  if (/\b(?:leftbarlink|leftbarshow|navigation_widgets|archive_title)\b/u.test(exact) && /legacy navigation$/u.test(heading)) {
    score += 96;
  }
  if (/\b(?:finished|generated|output)\b.*\b(?:directory|files?|folder)\b/u.test(exact) && /project paths$/u.test(heading)) {
    score += 128;
  }
  if (/\b(?:finished|generated|output)\b.*\b(?:directory|files?|folder)\b/u.test(exact) && /output ownership$/u.test(heading)) {
    score += 64;
  }
  if (/\b(?:change|choose|set)\b.*\b(?:directory|folder)\b/u.test(exact) && /project paths$/u.test(heading)) {
    score += 96;
  }
  if (/\b(?:change|choose|set)\b.*\b(?:directory|folder)\b/u.test(exact) && /output ownership$/u.test(heading)) {
    score += 80;
  }
  const matchesIntent = intents.some((intent) => chunk.intents?.includes(intent));
  const strongIntentMatch = matchesIntent && score >= STRONG_INTENT_RELEVANCE;
  if (score > 0 && matchesIntent) score += INTENT_MATCH_BOOST;
  if (score > 0 && currentUrl && comparablePath(chunk.url) === comparablePath(currentUrl)) {
    score += 28;
  }
  return { score, strongIntentMatch };
}

/**
 * Weight query terms by their rarity across the corpus.
 *
 * @param {CorpusChunk[]} chunks
 * @param {string[]} queryTerms
 */
function weightedTerms(chunks, queryTerms) {
  const useful = queryTerms.filter((term) => !LOW_VALUE_TERMS.has(term));
  const variants = [...new Set(useful.flatMap(termVariants))];
  return variants.map((value) => {
    const frequency = chunks.reduce((count, chunk) => {
      const searchable = normalized(`${chunk.title}\n${chunk.heading}\n${chunk.keywords?.join(" ") ?? ""}\n${chunk.content}`);
      return count + Number(searchable.includes(value));
    }, 0);
    return { value, weight: Math.log((chunks.length + 1) / (frequency + 1)) + 1 };
  });
}

/**
 * Split Markdown into paragraphs without splitting fenced code blocks.
 *
 * @param {string} content
 */
function contentBlocks(content) {
  /** @type {string[][]} */
  const blocks = [];
  /** @type {string[]} */
  let current = [];
  let fence = "";
  for (const line of content.split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/u)?.[1] ?? "";
    if (!fence && !line.trim()) {
      if (current.length) blocks.push(current);
      current = [];
      continue;
    }
    current.push(line);
    if (!marker) continue;
    if (!fence) fence = marker;
    else if (marker.startsWith(fence[0] ?? "")) fence = "";
  }
  if (current.length) blocks.push(current);
  const paragraphs = blocks.map((lines) => lines.join("\n").trim()).filter(Boolean);
  /** @type {string[]} */
  const structured = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    if (!paragraph) continue;
    const next = paragraphs[index + 1] ?? "";
    const introducesStructure = /:\s*$/u.test(paragraph)
      && (/^(?:[-*+]|\d+\.)\s+/mu.test(next) || /^\s*(?:`{3,}|~{3,})/u.test(next));
    if (introducesStructure) {
      structured.push(`${paragraph}\n\n${next}`);
      index += 1;
    } else {
      structured.push(paragraph);
    }
  }
  return structured;
}

/**
 * Keep the summary and query-relevant paragraphs from a long source passage.
 *
 * @param {CorpusChunk} chunk
 * @param {Array<{value: string, weight: number}>} terms
 */
function focusChunk(chunk, terms) {
  if (chunk.content.length <= MAX_SOURCE_CHARACTERS) return chunk;
  const blocks = contentBlocks(chunk.content);
  if (blocks.length < 2) {
    return { ...chunk, content: `${chunk.content.slice(0, MAX_SOURCE_CHARACTERS - 1).trimEnd()}…` };
  }
  const ranked = blocks.map((block, index) => ({
    block,
    index,
    score: terms.reduce((score, term) => score + occurrences(normalized(block), term.value) * term.weight, index === 0 ? 4 : 0)
  })).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = new Set([0]);
  let characters = blocks[0]?.length ?? 0;
  for (const candidate of ranked) {
    if (selected.has(candidate.index)) continue;
    const separator = selected.size ? 5 : 0;
    if (characters + separator + candidate.block.length > MAX_SOURCE_CHARACTERS) continue;
    selected.add(candidate.index);
    characters += separator + candidate.block.length;
  }
  const content = blocks.filter((_block, index) => selected.has(index)).join("\n\n");
  return { ...chunk, content };
}

/**
 * Report whether one strong passage should answer a narrowly phrased task.
 *
 * @param {string} query
 */
function focusedQuery(query) {
  const value = normalized(query);
  const asksForMenuMembership = /(?:\b(?:choose|select)\b.*\bpages?\b|\bpages?\b.*\b(?:belong|membership|opt (?:in|out))\b)/u.test(value);
  const asksForPublicUrl = /\b(?:base_url|public url|subdirectory)\b/u.test(value);
  const asksForPageFrontmatter = /\b(?:frontmatter|metadata|title|yaml)\b/u.test(value);
  const asksForTimeline = /\b(?:archive|blogger|timeline)\b/u.test(value) && /\b(?:calendar|date|month|year)\b/u.test(value);
  const asksForAssets = /\b(?:css|javascript|stylesheet|scripts?|static)\b/u.test(value) && /\b(?:add|custom|load|own|publish|watch)\b/u.test(value);
  const asksForTemplate = /\b(?:layout|template)\b/u.test(value) && /\b(?:custom|different|page|php)\b/u.test(value);
  const asksForMenuPlugins = /\b(?:plugin|bulk|include|exclude|selector|where)\b/u.test(value);
  const asksForPrecedence = /\b(?:override|beats?|wins?|precedence|order)\b/u.test(value) && /\b(?:config(?:uration)?|environment|shell|yaml)\b/u.test(value);
  const asksForLegacyNavigation = /\b(?:leftbarlink|leftbarshow|navigation_widgets|archive_title|legacy navigation)\b/u.test(value);
  return (/\bgithub pages\b/u.test(value) && !asksForPublicUrl)
    || (asksForPublicUrl && !/\bgithub pages\b/u.test(value))
    || asksForTimeline
    || asksForAssets
    || asksForTemplate
    || asksForPrecedence
    || asksForLegacyNavigation
    || (asksForMenuMembership
      && !asksForMenuPlugins
      && !/\b(?:add|another|create|custom|make|new).*(?:menu|navigation)\b/u.test(value))
    || /\b(?:empty|new) (?:directory|folder)\b/u.test(value)
    || (/\b(?:where|which).*(?:put|store|write).*(?:content|page|pages|words)\b/u.test(value) && !asksForPageFrontmatter)
    || (/\b(?:add|another|create|custom|make|new).*(?:menu|navigation)\b/u.test(value) && !asksForMenuMembership)
    || /\bwhat (?:does|is) (?:smgen|this)\b/u.test(value);
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
 * @property {string} [previousQuery]
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
  const searchQuery = options.previousQuery ? `${options.previousQuery} ${query}` : query;
  const queryTerms = tokenize(searchQuery);
  if (!queryTerms.length) return [];
  const terms = weightedTerms(chunks, queryTerms);
  const intents = questionIntents(query);
  const scored = chunks
    .map((chunk, index) => ({ chunk, index, ...scoreChunk(chunk, searchQuery, terms, options.currentUrl ?? "", intents) }))
    .filter((item) => item.score > 0);
  const hasStrongTaggedMatch = intents.length > 0 && scored.some(({ strongIntentMatch }) => strongIntentMatch);
  const ranked = scored
    .filter(({ chunk }) => !hasStrongTaggedMatch
      || !chunk.intents?.length
      || intents.some((intent) => chunk.intents?.includes(intent)))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const minimumScore = Math.max(8, (ranked[0]?.score ?? 0) * 0.35);
  /** @type {CorpusChunk[]} */
  const selected = [];
  const maxChunks = focusedQuery(query) ? 1 : options.maxChunks;
  const remaining = ranked.filter(({ score }) => score >= minimumScore);
  const sources = new Set();
  while (selected.length < maxChunks && remaining.length) {
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
    const fitted = fitCandidate(selected, focusChunk(item.chunk, terms), options.maxCharacters);
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
    ...(chunk.intents?.length ? [`Answers: ${chunk.intents.join(", ")}`] : []),
    chunk.content
  ].join("\n")).join("\n\n");
}
