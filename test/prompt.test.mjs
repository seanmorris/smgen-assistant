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
  assert.match(messages[0]?.content ?? "", /faithfully rephrasing only/iu);
  assert.match(messages[0]?.content ?? "", /Do not add commands/iu);
  assert.match(messages[0]?.content ?? "", /Cite every paragraph or list item/iu);
  assert.equal(messages.at(-1)?.content, "How do I build?");
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
