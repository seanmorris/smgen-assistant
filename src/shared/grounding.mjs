// @ts-check

/** @typedef {import('./types.mjs').CorpusChunk} CorpusChunk */

const LOW_VALUE_WORDS = new Set([
  "about", "after", "also", "and", "are", "author", "authors", "before", "can", "each", "for", "from", "into", "its", "let", "lets", "may", "need", "only", "own", "running", "that", "the", "their", "them", "then", "thing", "this", "through", "using", "with", "your"
]);
const QUERY_LOW_VALUE_WORDS = new Set([
  ...LOW_VALUE_WORDS,
  "a", "an", "do", "does", "how", "i", "in", "is", "it", "me", "my", "of", "on", "one", "or", "please", "rss", "should", "site", "smgen", "tell", "to", "use", "what", "when", "where", "which", "who", "will", "would", "you"
]);
const LEADING_ACTION_WORDS = new Set([
  "add", "build", "change", "configure", "copy", "create", "define", "edit", "enable", "generate", "initialize", "install", "link", "open", "place", "publish", "remove", "replace", "run", "select", "serve", "set", "upload", "write"
]);
const GROUNDED_EQUIVALENTS = new Map([
  ["additional", ["custom"]],
  ["assets", ["css", "javascript", "script", "stylesheet"]],
  ["browser", ["css", "javascript", "script", "stylesheet"]],
  ["create", ["initialize"]],
  ["creating", ["initialize"]],
  ["define", ["register"]],
  ["folder", ["directory"]],
  ["frontmatter", ["metadata", "yaml"]],
  ["generate", ["generated", "build"]],
  ["initialize", ["init"]],
  ["navigate", ["cd"]],
  ["new", ["empty", "first"]],
  ["opt", ["join", "membership"]],
  ["publish", ["build", "copy", "output", "rebuild"]],
  ["running", ["run"]],
  ["setting", ["set"]],
  ["view", ["open", "serve"]],
  ["without", ["absent", "missing"]],
  ["wins", ["highest", "override", "priority"]],
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
 * Remove private reasoning blocks and stray closing tags emitted by chat templates.
 *
 * @param {string} answer
 */
function visibleGeneratedText(answer) {
  let visible = answer.trim();
  while (/^<think>[\s\S]*?<\/think>\s*/iu.test(visible)) {
    visible = visible.replace(/^<think>[\s\S]*?<\/think>\s*/iu, "").trimStart();
  }
  return visible.replace(/\s*<\/think>\s*$/iu, "").trim();
}

/**
 * Build a short answer from exact prose in the strongest retrieved passage.
 *
 * @param {CorpusChunk} source
 * @param {string} [question]
 */
export function formatExtractiveAnswer(source, question = "") {
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
  /** @type {Array<{text: string, order: number}>} */
  const candidates = [];
  const consumed = new Set();
  for (const [index, paragraph] of paragraphs.entries()) {
    if (consumed.has(index)) continue;
    if (/^SMGEN_CODE_BLOCK_\d+$/u.test(paragraph.trim())) continue;
    const lines = paragraph.split("\n").map((line) => line.trim()).filter(Boolean);
    const list = lines.filter((line) => /^(?:[-*+]|\d+\.)\s+/u.test(line));
    const nextLines = (paragraphs[index + 1] ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
    const nextList = nextLines.filter((line) => /^(?:[-*+]|\d+\.)\s+/u.test(line));
    let blocks = list.length === lines.length ? list : [lines.join(" ")];
    if (blocks.length === 1 && blocks[0]?.endsWith(":") && nextList.length === nextLines.length && nextList.length) {
      const items = nextList.map((line) => line.replace(/^(?:[-*+]|\d+\.)\s+/u, "").replace(/[.;]\s*$/u, ""));
      blocks = [`${blocks[0]} ${items.join("; ")}.`];
      consumed.add(index + 1);
    }
    for (const block of blocks) {
      const cleaned = block.replace(/^(?:[-*+]|\d+\.)\s+/u, "").trim();
      const marker = paragraphs[index + 1]?.trim().match(/^SMGEN_CODE_BLOCK_(\d+)$/u);
      const code = marker ? codeBlocks[Number(marker[1])] : undefined;
      let commands = code && /^(?:bash|console|sh|shell)$/u.test(code.language)
        ? code.lines.filter((line) => line.length <= 80).slice(0, 3)
        : [];
      if (code && /^(?:yaml|yml)$/u.test(code.language) && question.trim()) {
        commands = code.lines
          .filter((line) => line !== "---" && line.length <= 100)
          .map((line, order) => ({ line, order, score: extractiveScore(line, question) }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score || a.order - b.order)
          .slice(0, 2)
          .sort((a, b) => a.order - b.order)
          .map(({ line }) => line);
      }
      const expanded = commands.length ? `${cleaned} ${commands.map((line) => `\`${line}\``).join(", ")}` : cleaned;
      const expandedBlocks = expanded.length <= 480
        ? [expanded]
        : (cleaned.match(/[^.!?]+[.!?](?:\s|$)/gu)?.map((sentence) => sentence.trim()) ?? []);
      for (const text of expandedBlocks) {
        if (text
          && text !== "…"
          && text.length <= 480
          && !/^#{1,6}\s/u.test(text)
          && !/^!\[[^\]]*\]\([^)]*\)$/u.test(text)) {
          candidates.push({ text, order: index });
        }
      }
    }
  }
  candidates.sort((a, b) => extractiveScore(b.text, question) - extractiveScore(a.text, question) || a.order - b.order);
  /** @type {string[]} */
  const selected = [];
  let characters = 0;
  for (const candidate of candidates) {
    if (selected.length >= 4) break;
    if (characters + candidate.text.length > 720) continue;
    selected.push(candidate.text);
    characters += candidate.text.length;
  }
  return selected.map((block) => `- ${block} [Source 1]`).join("\n");
}

/**
 * Build a balanced extractive fallback across the supplied passages.
 *
 * @param {CorpusChunk[]} sources
 * @param {string} [question]
 * @returns {{answer: string, sources: CorpusChunk[]}}
 */
export function formatExtractiveAnswerSet(sources, question = "") {
  const candidates = sources.slice(0, 4);
  const perSource = Math.max(1, Math.floor(4 / Math.max(1, candidates.length)));
  /** @type {string[]} */
  const bullets = [];
  /** @type {CorpusChunk[]} */
  const selected = [];
  for (const source of candidates) {
    const extracted = formatExtractiveAnswer(source, question).split("\n").filter(Boolean).slice(0, perSource);
    if (!extracted.length) continue;
    const sourceNumber = selected.push(source);
    bullets.push(...extracted.map((bullet) => bullet.replace(/\[Source 1\]/gu, `[Source ${sourceNumber}]`)));
  }
  return { answer: bullets.slice(0, 4).join("\n"), sources: selected };
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
 * Check a generated technical literal against one documentation section.
 *
 * Shell commands joined with `&&` or `;` are accepted only when every command
 * appears independently in the section. This keeps a model from inventing a
 * command while allowing it to combine documented setup steps on one line.
 *
 * @param {string} literal
 * @param {string} documentation
 */
function literalHasSourceSupport(literal, documentation) {
  const normalized = comparable(literal);
  if (documentation.includes(normalized)) return true;
  const commands = normalized.split(/\s*(?:&&|;)\s*/u).filter(Boolean);
  return commands.length > 1 && commands.every((command) => documentation.includes(command));
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
  if (word.length > 3 && !word.endsWith("s")) variants.add(`${word}s`);
  return [...variants];
}

/**
 * Tokenize prose for question coverage and extractive ranking.
 *
 * @param {string} text
 */
function topicTerms(text) {
  const terms = new Set();
  for (const match of text.normalize("NFKC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}_./:+#-]+/gu) ?? []) {
    terms.add(match);
    for (const part of match.split(/[_./:+#-]+/gu)) if (part) terms.add(part);
  }
  return terms;
}

/**
 * Rank an exact documentation excerpt by how directly it addresses a question.
 *
 * @param {string} text
 * @param {string} question
 */
function extractiveScore(text, question) {
  if (!question.trim()) return 0;
  const candidateTerms = topicTerms(text);
  const questionTerms = [...topicTerms(question)].filter((term) => term.length > 2 && !QUERY_LOW_VALUE_WORDS.has(term));
  const topicScore = questionTerms.reduce((score, term) => {
    const matched = groundedVariants(term).some((variant) => candidateTerms.has(variant));
    return score + (matched ? (/[_./:+#-]/u.test(term) ? 8 : 2) : 0);
  }, 0);
  return topicScore + (/\b(?:in this order|it renders|selector supports):/iu.test(text) ? 4 : 0);
}

/**
 * Check that a grounded answer still addresses the concrete topics in the question.
 *
 * @param {string} answer
 * @param {CorpusChunk[]} sources
 * @param {string} question
 * @returns {{ok: true} | {ok: false, reason: string, missing: string[]}}
 */
function validateQuestionCoverage(answer, sources, question) {
  if (!question.trim()) return { ok: true };
  const documentation = comparable(sources.map((source) => source.content).join("\n")).toLocaleLowerCase("en-US");
  const normalizedAnswer = comparable(answer).toLocaleLowerCase("en-US");
  const requiredLiterals = technicalLiterals(question).filter((literal) => documentation.includes(comparable(literal).toLocaleLowerCase("en-US")));
  const missingLiterals = requiredLiterals.filter((literal) => !normalizedAnswer.includes(comparable(literal).toLocaleLowerCase("en-US")));
  if (missingLiterals.length) return { ok: false, reason: "incomplete-answer", missing: missingLiterals };

  const sourceTerms = topicTerms(documentation);
  const answerTerms = topicTerms(normalizedAnswer);
  const relevant = [...topicTerms(question)].filter((term) => term.length > 2
    && !QUERY_LOW_VALUE_WORDS.has(term)
    && groundedVariants(term).some((variant) => sourceTerms.has(variant)));
  const unique = [...new Set(relevant)];
  if (!unique.length) return { ok: true };
  const covered = unique.filter((term) => groundedVariants(term).some((variant) => answerTerms.has(variant)));
  const minimum = unique.length < 3 ? unique.length : Math.max(2, Math.min(8, Math.ceil(unique.length * 0.7)));
  if (covered.length < minimum) {
    return { ok: false, reason: "incomplete-answer", missing: unique.filter((term) => !covered.includes(term)).slice(0, 4) };
  }
  if (/\b(?:order|precedence|which .*wins?|wins?)\b/iu.test(question)
    && /\b(?:lowest|highest|order|precedence|override|priority|wins?|before|after)\b/iu.test(documentation)
    && !/\b(?:lowest|highest|order|precedence|override|priority|wins?|before|after)\b/iu.test(answer)) {
    return { ok: false, reason: "incomplete-answer", missing: ["precedence"] };
  }
  return { ok: true };
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
  const documentation = comparable(source.content);
  if (literals.some((literal) => !literalHasSourceSupport(literal, documentation))) return -1;
  const sourceWords = new Set(documentation.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? []);
  const supported = words.filter((word) => groundedVariants(word).some((variant) => sourceWords.has(variant))).length;
  const ratio = words.length ? supported / words.length : 1;
  const firstWord = text.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/u)?.[0] ?? "";
  const unsupportedAction = LEADING_ACTION_WORDS.has(firstWord)
    && !groundedVariants(firstWord).some((variant) => sourceWords.has(variant));
  if (unsupportedAction || supported < Math.min(2, words.length) || ratio < 0.5) return -1;
  return supported * 10 + ratio;
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
  if (blocks.some((block) => /(?:`{3,}|~{3,})/u.test(block))) {
    return { ok: false, reason: "unsupported-content" };
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
 * @param {string} [question]
 * @returns {{ok: true, answer: string, sources: CorpusChunk[], filtered: boolean} | {ok: false, reason: string, unsupported?: string[], missing?: string[]}}
 */
export function formatGeneratedAnswer(answer, sources, _finishReason, question = "") {
  const visible = visibleGeneratedText(answer);
  if (!visible) return { ok: false, reason: "empty" };
  if (!sources.length) return { ok: false, reason: "missing-sources" };
  const rawBlocks = proseBlocks(visible).slice(0, 6);
  /** @type {Array<{content: string, source: number}>} */
  const matched = [];
  for (const [blockIndex, raw] of rawBlocks.entries()) {
    const normalized = raw
      .replace(/^\s*(?:[-*+]|\d+\.)\s*/u, "")
      .replace(/\s*\[Source \d+\]\s*/gu, "")
      .trim();
    if (!normalized
      || normalized.length > 280
      || /^#{1,6}\s/u.test(normalized)
      || /(?:`{3,}|~{3,})/u.test(normalized)
      || /<\/?[a-z][a-z\d-]*(?:\s[^>]*)?>/iu.test(normalized)) {
      if (blockIndex === 0) return { ok: false, reason: "unsupported-content" };
      continue;
    }
    if (/:$/u.test(normalized)) {
      if (blockIndex === 0) return { ok: false, reason: "unsupported-content" };
      continue;
    }
    const content = /[.!?]$/u.test(normalized) ? normalized : `${normalized}.`;
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
  const coverage = validateQuestionCoverage(markdown, sources, question);
  if (!coverage.ok) return coverage;
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
