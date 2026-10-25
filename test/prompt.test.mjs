// @ts-check

import assert from "node:assert/strict";
import test from "node:test";
import { fitPrompt, MAX_OUTPUT_TOKENS, MAX_PROMPT_TOKENS, promptMessages, questionUsesPreviousContext } from "../src/shared/prompt.mjs";
import { questionIntents } from "../src/shared/intent.mjs";

/** @type {import("../src/shared/types.mjs").CorpusChunk[]} */
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
  assert.match(messages[0]?.content ?? "", /Cover every part of the question/iu);
  assert.match(messages[0]?.content ?? "", /ignore a supplied source when it does not help/iu);
  assert.match(messages.at(-1)?.content ?? "", /Answer directly in one to four short Markdown bullets/iu);
  assert.match(messages.at(-1)?.content ?? "", /at most 90 words/iu);
  assert.match(messages.at(-1)?.content ?? "", /Never use code fences or HTML/iu);
  assert.match(messages.at(-1)?.content ?? "", /one bullet per requested action or decision/iu);
  assert.match(messages.at(-1)?.content ?? "", /interface adds them/iu);
  assert.match(messages.at(-1)?.content ?? "", /Do not infer a step, prerequisite, or purpose/iu);
  assert.match(messages.at(-1)?.content ?? "", /^Question: How do I build\?/u);
});

test("only referential questions receive prior-turn context", () => {
  assert.equal(questionUsesPreviousContext("What about plugins?"), true);
  assert.equal(questionUsesPreviousContext("How do I configure it?"), true);
  assert.equal(questionUsesPreviousContext("How do I deploy to GitHub Pages?"), false);
});

test("question forms guide the requested kind of answer", () => {
  assert.deepEqual(questionIntents("What does the builder create?"), ["what"]);
  assert.deepEqual(questionIntents("Give me a definition of the builder."), ["what"]);
  assert.deepEqual(questionIntents("What is the right way to build it?"), ["how"]);
  assert.deepEqual(questionIntents("What commands and files do I need to build it?"), ["how"]);
  assert.deepEqual(questionIntents("Where is it written and when does that happen?"), ["where", "when"]);
  assert.deepEqual(questionIntents("Why does it run, and who runs it?"), ["why", "who"]);
  assert.match(promptMessages("How do I build it?", sources).at(-1)?.content ?? "", /HOW: give the documented method or actions/iu);
  assert.match(promptMessages("What does it build?", sources).at(-1)?.content ?? "", /WHAT: state the documented identity, behavior, or value/iu);
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

test("prompt fitting trims a second relevant passage before dropping it", async () => {
  /** @type {import("../src/shared/types.mjs").CorpusChunk} */
  const primary = { id: "1", sourceId: "a", title: "Start", heading: "Create a Site", url: "/index.html#create-a-site", content: "Primary instructions. ".repeat(5) };
  /** @type {import("../src/shared/types.mjs").CorpusChunk} */
  const secondary = { id: "2", sourceId: "b", title: "Config", heading: "Settings", url: "/configuration.html#settings", content: "Secondary configuration. ".repeat(90) };
  const fitted = await fitPrompt("How do I configure both parts?", [primary, secondary], "", countCharacters);
  assert.ok(fitted);
  assert.equal(fitted?.sources.length, 2);
  assert.equal(fitted?.sources[0]?.content, primary.content);
  assert.match(fitted?.sources[1]?.content ?? "", /…$/u);
  assert.ok((fitted?.promptTokens ?? Infinity) <= MAX_PROMPT_TOKENS);
});

test("prompt fitting rejects a question that cannot fit by itself", async () => {
  const fitted = await fitPrompt("x".repeat(MAX_PROMPT_TOKENS + 1), sources, "", countCharacters);
  assert.equal(fitted, null);
  assert.equal(MAX_PROMPT_TOKENS + MAX_OUTPUT_TOKENS, 2048);
});
