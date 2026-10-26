// @ts-check

import { formatContext } from "./retrieval.mjs";
import { questionIntentInstruction } from "./intent.mjs";

/** @typedef {import('./types.mjs').CorpusChunk} CorpusChunk */

export const CONTEXT_TOKENS = 2048;
export const MAX_OUTPUT_TOKENS = 384;
export const MAX_PROMPT_TOKENS = CONTEXT_TOKENS - MAX_OUTPUT_TOKENS;
export const MAX_QUESTION_CHARACTERS = 2000;

const INSTRUCTIONS = `Use only the numbered documentation sources below.
Never add a fact from memory. Copy commands, filenames, configuration keys, and literal values exactly from the cited source.
Prefer earlier sources. Use a later source only when it adds a fact that directly answers the question.
Cover every part of the question before adding supporting detail. Ignore a supplied source when it does not help answer the question.
Select only the most useful facts. Do not enumerate settings or examples unless the question asks for them. Do not write a complete guide or exhaust the sources.`;

const OUTPUT_INSTRUCTIONS = `Answer directly in one to four short Markdown bullets, at most 90 words.
Paraphrase the sources naturally. Do not infer a step, prerequisite, or purpose that the sources do not state.
Use one bullet per requested action or decision before adding detail.
Start each bullet with a hyphen and a complete sentence. Keep each bullet within one source.
Use inline backticks for commands, filenames, configuration keys, and literal values. Never use code fences or HTML.
Do not write citations or source labels; the interface adds them.
Do not use answer-form labels, nested bullets, bold labels, headings, prefaces, closing notes, or facts absent from the sources.`;

/**
 * Report whether a question needs the previous user turn to resolve a reference.
 *
 * @param {string} question
 */
export function questionUsesPreviousContext(question) {
  return /^(?:and|also|how about|then|what about|what if)\b|\b(?:it|that|them|these|those)\b/iu.test(question.trim());
}

/**
 * Build the model messages from a question and selected source passages.
 *
 * @param {string} question
 * @param {CorpusChunk[]} sources
 * @param {string} [previousQuestion]
 */
export function promptMessages(question, sources, previousQuestion = "") {
  const intentInstruction = questionIntentInstruction(question);
  const messages = /** @type {Array<{role: "system" | "user" | "assistant", content: string}>} */ ([{
    role: "system",
    content: `${INSTRUCTIONS}\n\n${formatContext(sources)}`
  }]);
  if (previousQuestion) messages.push({ role: "user", content: `Earlier question for context: ${previousQuestion}` });
  messages.push({ role: "user", content: `Question: ${question}\n${intentInstruction ? `Response focus: ${intentInstruction}\n` : ""}\n${OUTPUT_INSTRUCTIONS}` });
  return messages;
}

/**
 * Shorten one passage to a character boundary that fits the token budget.
 *
 * @param {string} question
 * @param {CorpusChunk} source
 * @param {(messages: Array<{role: "system" | "user" | "assistant", content: string}>) => Promise<number>} countTokens
 * @param {CorpusChunk[]} [earlierSources]
 * @returns {Promise<CorpusChunk | null>}
 */
async function truncateSource(question, source, countTokens, earlierSources = []) {
  let low = 0;
  let high = source.content.length;
  let fitted = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const content = middle < source.content.length
      ? `${source.content.slice(0, Math.max(0, middle - 1)).trimEnd()}…`
      : source.content;
    const candidate = { ...source, content };
    if (await countTokens(promptMessages(question, [...earlierSources, candidate])) <= MAX_PROMPT_TOKENS) {
      fitted = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (fitted < 1) return null;
  return fitted < source.content.length
    ? { ...source, content: `${source.content.slice(0, Math.max(0, fitted - 1)).trimEnd()}…` }
    : source;
}

/**
 * Fit source passages and optional follow-up context into the exact prompt budget.
 *
 * @param {string} question
 * @param {CorpusChunk[]} sources
 * @param {string} previousQuestion
 * @param {(messages: Array<{role: "system" | "user" | "assistant", content: string}>) => Promise<number>} countTokens
 * @returns {Promise<{messages: Array<{role: "system" | "user" | "assistant", content: string}>, sources: CorpusChunk[], promptTokens: number} | null>}
 */
export async function fitPrompt(question, sources, previousQuestion, countTokens) {
  let selected = [...sources];
  let previous = previousQuestion;
  let messages = promptMessages(question, selected, previous);
  let promptTokens = await countTokens(messages);
  if (promptTokens <= MAX_PROMPT_TOKENS) return { messages, sources: selected, promptTokens };

  if (previous) {
    previous = "";
    messages = promptMessages(question, selected);
    promptTokens = await countTokens(messages);
    if (promptTokens <= MAX_PROMPT_TOKENS) return { messages, sources: selected, promptTokens };
  }

  while (selected.length > 2) {
    selected = selected.slice(0, -1);
    messages = promptMessages(question, selected);
    promptTokens = await countTokens(messages);
    if (promptTokens <= MAX_PROMPT_TOKENS) return { messages, sources: selected, promptTokens };
  }

  if (selected.length === 2 && selected[0] && selected[1]) {
    const first = selected[0];
    const second = await truncateSource(question, selected[1], countTokens, [first]);
    if (second && second.content.length >= 48) {
      selected = [first, second];
      messages = promptMessages(question, selected);
      promptTokens = await countTokens(messages);
      if (promptTokens <= MAX_PROMPT_TOKENS) return { messages, sources: selected, promptTokens };
    }
    selected = [first];
  }

  if (selected[0]) {
    const source = await truncateSource(question, selected[0], countTokens);
    if (source) {
      selected = [source];
      messages = promptMessages(question, selected);
      promptTokens = await countTokens(messages);
      if (promptTokens <= MAX_PROMPT_TOKENS) return { messages, sources: selected, promptTokens };
    }
  }

  messages = promptMessages(question, []);
  promptTokens = await countTokens(messages);
  return promptTokens <= MAX_PROMPT_TOKENS ? { messages, sources: [], promptTokens } : null;
}
