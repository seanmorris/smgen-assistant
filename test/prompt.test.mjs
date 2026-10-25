// @ts-check

import assert from "node:assert/strict";
import test from "node:test";
import { fitPrompt, MAX_OUTPUT_TOKENS, MAX_PROMPT_TOKENS, promptMessages } from "../src/shared/prompt.mjs";

const sources = [
  { id: "1", sourceId: "a", title: "Start", heading: "Create a Site", url: "/index.html#create-a-site", content: "Build instructions. ".repeat(55) },
  { id: "2", sourceId: "b", title: "Config", heading: "Settings", url: "/configuration.html#settings", content: "Configuration details. ".repeat(55) }
];

/**
 * Count prompt characters as deterministic stand-in tokens.
 *
 * @param {Array<{content: string}>} messages
 */
async function countCharacters(messages) {
  return messages.reduce((count, message) => count + message.content.length, 0);
}

test("prompt instructions require faithful cited paraphrases", () => {
  const messages = promptMessages("How do I build?", sources);
  assert.match(messages[0]?.content ?? "", /Use only the numbered documentation sources/iu);
  assert.match(messages[0]?.content ?? "", /Copy commands, filenames, configuration keys/iu);
  assert.match(messages[0]?.content ?? "", /Prefer earlier sources/iu);
  assert.match(messages.at(-1)?.content ?? "", /Return a JSON object with an "items" array/iu);
  assert.match(messages.at(-1)?.content ?? "", /Return one or two items and no more than 36 words total/iu);
  assert.match(messages.at(-1)?.content ?? "", /Never put a list, newline, heading, example, or code fence inside text/iu);
  assert.match(messages.at(-1)?.content ?? "", /Do not infer a step, prerequisite, or purpose/iu);
  assert.match(messages.at(-1)?.content ?? "", /^Question: How do I build\?/u);
});

test("prompt fitting drops old context and low-ranked sources", async () => {
  const fitted = await fitPrompt("How do I build?", sources, "x".repeat(900), countCharacters);
  assert.ok(fitted);
  assert.ok((fitted?.promptTokens ?? Infinity) <= MAX_PROMPT_TOKENS);
  assert.equal(fitted?.messages.some((message) => message.content.includes("Earlier question")), false);
  assert.ok((fitted?.sources.length ?? 0) >= 1);
  assert.ok((fitted?.sources.length ?? Infinity) < sources.length);
  assert.equal(fitted?.messages.some((message) => message.role === "assistant"), false);
});

test("prompt fitting rejects a question that cannot fit by itself", async () => {
  const fitted = await fitPrompt("x".repeat(MAX_PROMPT_TOKENS + 1), sources, "", countCharacters);
  assert.equal(fitted, null);
  assert.equal(MAX_PROMPT_TOKENS + MAX_OUTPUT_TOKENS, 2048);
});
