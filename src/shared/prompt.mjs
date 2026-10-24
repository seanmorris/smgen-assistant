// @ts-check

import { formatContext } from "./retrieval.mjs";

/** @typedef {import('./types.mjs').CorpusChunk} CorpusChunk */

export const CONTEXT_TOKENS = 2048;
export const MAX_OUTPUT_TOKENS = 384;
export const MAX_PROMPT_TOKENS = CONTEXT_TOKENS - MAX_OUTPUT_TOKENS;
export const MAX_QUESTION_CHARACTERS = 2000;

const INSTRUCTIONS = `Answer by faithfully rephrasing only the supplied documentation.
Do not add commands, options, filenames, features, or facts that are absent from the sources.
Copy every command, code identifier, configuration key, and literal value exactly.
If the sources do not answer the question, say that the documentation does not cover it.
Keep the answer concise. Cite every paragraph or list item with one or more citations such as [Source 1].
The citation labels refer only to the numbered sources below.`;

/**
 * Build the model messages from a question and selected source passages.
 *
 * @param {string} question
 * @param {CorpusChunk[]} sources
 * @param {string} [previousQuestion]
 */
export function promptMessages(question, sources, previousQuestion = "") {
  const messages = /** @type {Array<{role: "system" | "user" | "assistant", content: string}>} */ ([{
    role: "system",
    content: `${INSTRUCTIONS}\n\n${formatContext(sources)}`
  }]);
  if (previousQuestion) messages.push({ role: "user", content: `Earlier question for context: ${previousQuestion}` });
  messages.push({ role: "user", content: question });
  return messages;
}

/**
 * Shorten one passage to a character boundary that fits the token budget.
 *
 * @param {string} question
 * @param {CorpusChunk} source
 * @param {(messages: Array<{role: "system" | "user" | "assistant", content: string}>) => Promise<number>} countTokens
 * @returns {Promise<CorpusChunk | null>}
 */
async function truncateSource(question, source, countTokens) {
  let low = 0;
  let high = source.content.length;
  let fitted = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const content = middle < source.content.length
      ? `${source.content.slice(0, Math.max(0, middle - 1)).trimEnd()}…`
      : source.content;
    const candidate = { ...source, content };
    if (await countTokens(promptMessages(question, [candidate])) <= MAX_PROMPT_TOKENS) {
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

  while (selected.length > 1) {
    selected = selected.slice(0, -1);
    messages = promptMessages(question, selected);
    promptTokens = await countTokens(messages);
    if (promptTokens <= MAX_PROMPT_TOKENS) return { messages, sources: selected, promptTokens };
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
