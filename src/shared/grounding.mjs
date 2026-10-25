// @ts-check

/** @typedef {import('./types.mjs').CorpusChunk} CorpusChunk */

const LOW_VALUE_WORDS = new Set([
  "about", "after", "also", "and", "are", "before", "can", "each", "for", "from", "into", "its", "need", "only", "that", "the", "then", "this", "through", "using", "with", "your"
]);
const GROUNDED_EQUIVALENTS = new Map([
  ["create", ["initialize"]],
  ["creating", ["initialize"]],
  ["generate", ["generated", "build"]],
  ["initialize", ["init"]],
  ["navigate", ["cd"]],
  ["new", ["empty", "first"]],
  ["running", ["run"]],
  ["setting", ["set"]],
  ["website", ["site"]]
]);

/**
 * Normalize technical text for exact source comparisons across line wrapping.
 *
 * @param {string} value
 */
function comparable(value) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/**
 * Extract Markdown prose blocks that each require their own citation.
 *
 * @param {string} answer
 */
function proseBlocks(answer) {
  const prose = answer.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gmu, "");
  return prose.split(/\n\s*\n/gu).flatMap((paragraph) => {
    const lines = paragraph.split("\n").filter((line) => line.trim());
    const listItems = lines.filter((line) => /^\s*(?:[-*+]|\d+\.)\s+/u.test(line));
    return listItems.length ? listItems : [paragraph];
  }).map((block) => block.trim()).filter((block) => block && !/^#{1,6}\s/u.test(block));
}

/**
 * Extract source-sensitive technical literals from a generated answer.
 *
 * @param {string} answer
 */
function technicalLiterals(answer) {
  const literals = new Set();
  for (const match of answer.matchAll(/`([^`\n]+)`/gu)) literals.add(match[1]?.trim());
  for (const match of answer.matchAll(/\b(?=[A-Z\d_]*_)[A-Z][A-Z\d_]{2,}\b/gu)) literals.add(match[0]);
  for (const match of answer.matchAll(/(?:^|\s)(\.[\w.-]+\.(?:ya?ml|json|md|php|sh))\b/giu)) literals.add(match[1]);
  return [...literals].filter((value) => value && !/^Source \d+$/u.test(value));
}

/**
 * Produce conservative variants for checking paraphrased source words.
 *
 * @param {string} word
 */
function groundedVariants(word) {
  const variants = new Set([word, ...(GROUNDED_EQUIVALENTS.get(word) ?? [])]);
  if (word.length > 4 && word.endsWith("ing")) variants.add(word.slice(0, -3).replace(/(.)\1$/u, "$1"));
  if (word.length > 4 && word.endsWith("ed")) variants.add(word.slice(0, -2).replace(/(.)\1$/u, "$1"));
  if (word.length > 4 && word.endsWith("s")) variants.add(word.slice(0, -1));
  return [...variants];
}

/**
 * Require every meaningful prose word to occur in, or conservatively map to, its source.
 *
 * @param {string} text
 * @param {CorpusChunk} source
 */
function wordingIsGrounded(text, source) {
  const documentation = comparable(source.content).toLocaleLowerCase("en-US");
  const words = [...new Set((text.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => word.length > 2 && !LOW_VALUE_WORDS.has(word)))];
  return words.every((word) => groundedVariants(word).some((variant) => documentation.includes(variant)));
}

/**
 * Find repeated answer blocks after removing numbering and citations.
 *
 * @param {string[]} blocks
 */
function repeatedBlocks(blocks) {
  const seen = new Set();
  for (const block of blocks) {
    const value = comparable(block)
      .replace(/^\s*(?:[-*+]|\d+\.)\s*/u, "")
      .replace(/\s*\[Source \d+\]\s*$/u, "")
      .toLocaleLowerCase("en-US");
    if (value.length < 12) continue;
    if (seen.has(value)) return true;
    seen.add(value);
  }
  return false;
}

/**
 * Verify that a generated answer remains traceable to its supplied sources.
 *
 * @param {string} answer
 * @param {CorpusChunk[]} sources
 * @param {string | null} finishReason
 * @returns {{ok: true} | {ok: false, reason: string, unsupported?: string[]}}
 */
export function validateGroundedAnswer(answer, sources, finishReason) {
  if (!answer.trim()) return { ok: false, reason: "empty" };
  if (finishReason === "length") return { ok: false, reason: "truncated" };
  if (!sources.length) return { ok: false, reason: "missing-sources" };

  const citations = [...answer.matchAll(/\[Source (\d+)\]/gu)].map((match) => Number(match[1]));
  if (!citations.length || citations.some((source) => source < 1 || source > sources.length)) {
    return { ok: false, reason: "invalid-citations" };
  }
  const blocks = proseBlocks(answer);
  if (blocks.length > 4 || answer.trim().split(/\s+/u).length > 120) {
    return { ok: false, reason: "too-long" };
  }
  if (blocks.some((block) => block.length > 20 && !/\[Source \d+\]/u.test(block))) {
    return { ok: false, reason: "missing-block-citation" };
  }
  if (repeatedBlocks(blocks)) return { ok: false, reason: "repetition" };

  const unsupported = [...new Set(blocks.flatMap((block) => {
    const sourceNumbers = [...block.matchAll(/\[Source (\d+)\]/gu)].map((match) => Number(match[1]));
    const documentation = comparable(sourceNumbers.map((number) => sources[number - 1]?.content ?? "").join("\n"));
    return technicalLiterals(block).filter((literal) => !documentation.includes(comparable(literal)));
  }))];
  if (unsupported.length) return { ok: false, reason: "unsupported-literals", unsupported };
  return { ok: true };
}

/**
 * Convert grammar-constrained model JSON into cited Markdown after validation.
 *
 * @param {string} answer
 * @param {CorpusChunk[]} sources
 * @param {string | null} finishReason
 * @returns {{ok: true, answer: string, sources: CorpusChunk[]} | {ok: false, reason: string, unsupported?: string[]}}
 */
export function formatGroundedAnswer(answer, sources, finishReason) {
  if (finishReason === "length") return { ok: false, reason: "truncated" };
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(answer);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  if (!parsed || typeof parsed !== "object" || !("items" in parsed) || !Array.isArray(parsed.items)) {
    return { ok: false, reason: "invalid-shape" };
  }
  if (parsed.items.length < 1 || parsed.items.length > 4) return { ok: false, reason: "invalid-shape" };
  /** @type {Array<{content: string, source: number}>} */
  const items = [];
  for (const item of parsed.items) {
    if (!item || typeof item !== "object" || !("text" in item) || !("source" in item)) {
      return { ok: false, reason: "invalid-shape" };
    }
    if (typeof item.text !== "string" || !Number.isInteger(item.source)) {
      return { ok: false, reason: "invalid-shape" };
    }
    let source = Number(item.source);
    const content = item.text.trim().replace(/\s+/gu, " ").replace(/^(?:[-*+]|\d+\.)\s+/u, "");
    if (!content || content.length > 180 || /(?:`{3,}|~{3,}|\[Source \d+\])/u.test(content) || source < 1 || source > sources.length) {
      return { ok: false, reason: "invalid-shape" };
    }
    const literals = technicalLiterals(content);
    if (literals.length) {
      const supportedSource = sources.findIndex((candidate) => {
        const documentation = comparable(candidate.content);
        return literals.every((literal) => documentation.includes(comparable(literal)));
      });
      if (supportedSource >= 0) source = supportedSource + 1;
    }
    const sourceChunk = sources[source - 1];
    if (!sourceChunk || !wordingIsGrounded(content, sourceChunk)) continue;
    const candidate = `- ${content} [Source ${source}]`;
    if (!validateGroundedAnswer(candidate, sources, finishReason).ok) continue;
    if (!items.some((item) => comparable(item.content).toLocaleLowerCase("en-US") === comparable(content).toLocaleLowerCase("en-US"))) {
      items.push({ content, source });
    }
  }
  if (items.length < Math.min(2, parsed.items.length)) return { ok: false, reason: "unsupported-content" };
  const sourceNumbers = [...new Set(items.map((item) => item.source))];
  const selectedSources = sourceNumbers.map((number) => sources[number - 1]).filter((source) => source !== undefined);
  const markdown = items.map((item) => `- ${item.content} [Source ${sourceNumbers.indexOf(item.source) + 1}]`).join("\n");
  const grounding = validateGroundedAnswer(markdown, selectedSources, finishReason);
  return grounding.ok ? { ok: true, answer: markdown, sources: selectedSources } : grounding;
}
