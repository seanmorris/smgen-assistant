// @ts-check

/** @typedef {import('./types.mjs').CorpusChunk} CorpusChunk */

const LOW_VALUE_WORDS = new Set([
  "about", "after", "also", "and", "are", "author", "authors", "before", "can", "each", "for", "from", "into", "its", "let", "lets", "may", "need", "only", "own", "running", "that", "the", "their", "them", "then", "thing", "this", "through", "using", "with", "your"
]);
const GROUNDED_EQUIVALENTS = new Map([
  ["additional", ["custom"]],
  ["create", ["initialize"]],
  ["creating", ["initialize"]],
  ["define", ["register"]],
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
 * Build a short answer from exact prose in the strongest retrieved passage.
 *
 * @param {CorpusChunk} source
 */
export function formatExtractiveAnswer(source) {
  /** @type {Array<{language: string, lines: string[]}>} */
  const codeBlocks = [];
  const prose = source.content.replace(/^\s*(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^\s*\1\s*$/gmu, (block, _fence, language, code) => {
    const index = codeBlocks.push({
      language: String(language).trim().toLocaleLowerCase("en-US"),
      lines: String(code).split("\n").map((line) => line.trim()).filter(Boolean)
    }) - 1;
    return `\n\nSMGEN_CODE_BLOCK_${index}\n\n`;
  });
  const paragraphs = prose.split(/\n\s*\n/gu);
  const candidates = paragraphs.flatMap((paragraph, index) => {
    if (/^SMGEN_CODE_BLOCK_\d+$/u.test(paragraph.trim())) return [];
    const lines = paragraph.split("\n").map((line) => line.trim()).filter(Boolean);
    const list = lines.filter((line) => /^(?:[-*+]|\d+\.)\s+/u.test(line));
    const blocks = list.length === lines.length ? list : [lines.join(" ")];
    return blocks.flatMap((block) => {
      const cleaned = block.replace(/^(?:[-*+]|\d+\.)\s+/u, "").trim();
      const marker = paragraphs[index + 1]?.trim().match(/^SMGEN_CODE_BLOCK_(\d+)$/u);
      const code = marker ? codeBlocks[Number(marker[1])] : undefined;
      const commands = code && /^(?:bash|console|sh|shell)$/u.test(code.language)
        ? code.lines.filter((line) => line.length <= 80).slice(0, 3)
        : [];
      const expanded = commands.length ? `${cleaned} ${commands.map((line) => `\`${line}\``).join(", ")}` : cleaned;
      if (expanded.length <= 240) return [expanded];
      return cleaned.match(/[^.!?]+[.!?](?:\s|$)/gu)?.map((sentence) => sentence.trim()) ?? [];
    });
  }).filter((block) => block && block.length <= 240 && !/^#{1,6}\s/u.test(block));
  /** @type {string[]} */
  const selected = [];
  let characters = 0;
  for (const block of candidates) {
    if (selected.length >= 4 || characters + block.length > 520) break;
    selected.push(block);
    characters += block.length;
  }
  return selected.map((block) => `- ${block} [Source 1]`).join("\n");
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
 * Require enough shared topic words to keep a paraphrase tied to its source.
 *
 * @param {string} text
 * @param {CorpusChunk} source
 */
function wordingHasSourceSupport(text, source) {
  const documentation = new Set(comparable(source.content).toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? []);
  const words = [...new Set((text.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => word.length > 2 && !LOW_VALUE_WORDS.has(word)))];
  if (!words.length) return true;
  const supported = words.filter((word) => groundedVariants(word).some((variant) => documentation.has(variant))).length;
  const minimumSupported = words.length >= 5 ? 2 : 1;
  return supported >= minimumSupported && supported / words.length >= 0.4;
}

/**
 * Rank a generated block against one source after enforcing its literals.
 *
 * @param {string} text
 * @param {CorpusChunk} source
 */
function generatedSourceScore(text, source) {
  const words = [...new Set((text.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => word.length > 2 && !LOW_VALUE_WORDS.has(word)))];
  const literals = technicalLiterals(text);
  const segments = source.content.split(/\n\s*\n/gu).map(comparable).filter(Boolean);
  return segments.reduce((best, documentation) => {
    if (literals.some((literal) => !documentation.includes(comparable(literal)))) return best;
    const sourceWords = new Set(documentation.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? []);
    const supported = words.filter((word) => groundedVariants(word).some((variant) => sourceWords.has(variant))).length;
    const ratio = words.length ? supported / words.length : 1;
    if (supported < Math.min(2, words.length) || ratio < 0.6) return best;
    return Math.max(best, supported * 10 + ratio);
  }, -1);
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
  const unsupportedWording = blocks.some((block) => {
    const sourceNumbers = [...block.matchAll(/\[Source (\d+)\]/gu)].map((match) => Number(match[1]));
    if (!sourceNumbers.length) return true;
    const cited = sourceNumbers.map((number) => sources[number - 1]).filter((source) => source !== undefined);
    const wording = block.replace(/^\s*(?:[-*+]|\d+\.)\s*/u, "").replace(/\s*\[Source \d+\]\s*/gu, "").trim();
    return !cited.some((source) => wordingHasSourceSupport(wording, source));
  });
  if (unsupportedWording) return { ok: false, reason: "unsupported-content" };
  return { ok: true };
}

/**
 * Validate cited Markdown and retain only the sources its citations use.
 *
 * @param {string} answer
 * @param {CorpusChunk[]} sources
 * @param {string | null} finishReason
 * @returns {{ok: true, answer: string, sources: CorpusChunk[], filtered: false} | {ok: false, reason: string, unsupported?: string[]}}
 */
export function formatGroundedMarkdown(answer, sources, finishReason) {
  const trimmed = answer.trim();
  const grounding = validateGroundedAnswer(trimmed, sources, finishReason);
  if (!grounding.ok) return grounding;
  const numbers = [...new Set([...trimmed.matchAll(/\[Source (\d+)\]/gu)].map((match) => Number(match[1])))];
  const selected = numbers.map((number) => sources[number - 1]).filter((source) => source !== undefined);
  const positions = new Map(numbers.map((number, index) => [number, index + 1]));
  const markdown = trimmed.replace(/\[Source (\d+)\]/gu, (_citation, number) => `[Source ${positions.get(Number(number))}]`);
  return { ok: true, answer: markdown, sources: selected, filtered: false };
}

/**
 * Match generated prose to documentation and append verified citations.
 *
 * @param {string} answer
 * @param {CorpusChunk[]} sources
 * @param {string | null} _finishReason
 * @returns {{ok: true, answer: string, sources: CorpusChunk[], filtered: boolean} | {ok: false, reason: string, unsupported?: string[]}}
 */
export function formatGeneratedAnswer(answer, sources, _finishReason) {
  if (!answer.trim()) return { ok: false, reason: "empty" };
  if (!sources.length) return { ok: false, reason: "missing-sources" };
  const rawBlocks = proseBlocks(answer).slice(0, 6);
  /** @type {Array<{content: string, source: number}>} */
  const matched = [];
  for (const [blockIndex, raw] of rawBlocks.entries()) {
    const content = raw
      .replace(/^\s*(?:[-*+]|\d+\.)\s*/u, "")
      .replace(/\s*\[Source \d+\]\s*/gu, "")
      .trim();
    if (!content || content.length > 280 || /^#{1,6}\s/u.test(content)) {
      if (blockIndex === 0) return { ok: false, reason: "unsupported-content" };
      continue;
    }
    if (!/[.!?`]$/u.test(content)) {
      if (blockIndex === 0) return { ok: false, reason: "unsupported-content" };
      continue;
    }
    const ranked = sources
      .map((source, index) => ({ index, score: generatedSourceScore(content, source) }))
      .filter((candidate) => candidate.score >= 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const best = ranked[0];
    if (!best) {
      if (blockIndex === 0) return { ok: false, reason: "unsupported-content" };
      continue;
    }
    const key = comparable(content).toLocaleLowerCase("en-US");
    if (!matched.some((item) => comparable(item.content).toLocaleLowerCase("en-US") === key)) {
      matched.push({ content, source: best.index });
    }
    if (matched.length >= 4) break;
  }
  if (!matched.length) return { ok: false, reason: "unsupported-content" };
  const used = [...new Set(matched.map((item) => item.source))];
  const selected = used.map((index) => sources[index]).filter((source) => source !== undefined);
  const markdown = matched.map((item) => `- ${item.content} [Source ${used.indexOf(item.source) + 1}]`).join("\n");
  return { ok: true, answer: markdown, sources: selected, filtered: matched.length < rawBlocks.length };
}

/**
 * Convert model JSON into cited Markdown after validation.
 *
 * @param {string} answer
 * @param {CorpusChunk[]} sources
 * @param {string | null} finishReason
 * @returns {{ok: true, answer: string, sources: CorpusChunk[], filtered: boolean} | {ok: false, reason: string, unsupported?: string[]}}
 */
export function formatGroundedAnswer(answer, sources, finishReason) {
  if (finishReason === "length") return { ok: false, reason: "truncated" };
  /** @type {unknown} */
  let parsed;
  try {
    const trimmed = answer.trim();
    const unfenced = trimmed.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
    try {
      parsed = JSON.parse(unfenced);
    } catch {
      const start = unfenced.indexOf("{");
      const end = unfenced.lastIndexOf("}");
      if (start < 0 || end <= start) throw new SyntaxError("No JSON object found.");
      parsed = JSON.parse(unfenced.slice(start, end + 1));
    }
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  if (!parsed || typeof parsed !== "object" || !("items" in parsed) || !Array.isArray(parsed.items)) {
    return { ok: false, reason: "invalid-shape" };
  }
  if (parsed.items.length < 1 || parsed.items.length > 3) return { ok: false, reason: "invalid-shape" };
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
    if (!content || content.length > 140 || /(?:`{3,}|~{3,}|\[Source \d+\])/u.test(content) || source < 1 || source > sources.length) {
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
    if (!sourceChunk || !wordingHasSourceSupport(content, sourceChunk)) continue;
    const candidate = `- ${content} [Source ${source}]`;
    if (!validateGroundedAnswer(candidate, sources, finishReason).ok) continue;
    if (!items.some((item) => comparable(item.content).toLocaleLowerCase("en-US") === comparable(content).toLocaleLowerCase("en-US"))) {
      items.push({ content, source });
    }
  }
  if (!items.length) return { ok: false, reason: "unsupported-content" };
  const sourceNumbers = [...new Set(items.map((item) => item.source))];
  const selectedSources = sourceNumbers.map((number) => sources[number - 1]).filter((source) => source !== undefined);
  const markdown = items.map((item) => `- ${item.content} [Source ${sourceNumbers.indexOf(item.source) + 1}]`).join("\n");
  const grounding = validateGroundedAnswer(markdown, selectedSources, finishReason);
  return grounding.ok
    ? { ok: true, answer: markdown, sources: selectedSources, filtered: items.length < parsed.items.length }
    : grounding;
}
