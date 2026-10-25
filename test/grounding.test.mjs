// @ts-check

import assert from "node:assert/strict";
import test from "node:test";
import { formatExtractiveAnswer, formatGroundedAnswer, validateGroundedAnswer } from "../src/shared/grounding.mjs";

const sources = [{
  id: "1",
  sourceId: "start",
  title: "Getting Started",
  heading: "Create a Site",
  url: "/index.html#create-a-site",
  content: "Run `smgen init`, replace `pages/index.md`, then run `smgen build` and `smgen serve`."
}];

test("grounding accepts cited technical literals copied from a source", () => {
  const answer = "1. Run `smgen init`. [Source 1]\n2. Replace `pages/index.md`. [Source 1]";
  assert.deepEqual(validateGroundedAnswer(answer, sources, "stop"), { ok: true });
});

test("grounding rejects invented identifiers and commands", () => {
  const answer = "Set `SMGEN_CONFIG_PATH`, then run `smgen deploy`. [Source 1]";
  const result = validateGroundedAnswer(answer, sources, "stop");
  assert.equal(result.ok, false);
  assert.equal(result.ok ? "" : result.reason, "unsupported-literals");
  assert.deepEqual(result.ok ? [] : result.unsupported, ["SMGEN_CONFIG_PATH", "smgen deploy"]);
});

test("grounding rejects missing citations, repetition, and truncation", () => {
  assert.equal(validateGroundedAnswer("Run `smgen init`.", sources, "stop").ok, false);
  assert.equal(validateGroundedAnswer("Run `smgen init`. [Source 2]", sources, "stop").ok, false);
  assert.equal(validateGroundedAnswer("Run `smgen init`. [Source 1]", sources, "length").ok, false);
  const repeated = "1. Run `smgen init`. [Source 1]\n2. Run `smgen init`. [Source 1]";
  assert.equal(validateGroundedAnswer(repeated, sources, "stop").ok, false);
});

test("grounding rejects answers beyond the concise response shape", () => {
  const answer = Array.from({ length: 5 }, (_, index) => `- Step ${index + 1} uses \`smgen init\`. [Source 1]`).join("\n");
  assert.deepEqual(validateGroundedAnswer(answer, sources, "stop"), { ok: false, reason: "too-long" });
});

test("structured answers become concise cited Markdown", () => {
  const answer = JSON.stringify({ items: [
    { text: "Run `smgen init`.", source: 1 },
    { text: "Replace `pages/index.md`.", source: 1 }
  ] });
  assert.deepEqual(formatGroundedAnswer(answer, sources, "stop"), {
    ok: true,
    answer: "- Run `smgen init`. [Source 1]\n- Replace `pages/index.md`. [Source 1]",
    sources,
    filtered: false
  });
});

test("structured answers reject invalid JSON and unsupported cited literals", () => {
  assert.deepEqual(formatGroundedAnswer("not json", sources, "stop"), { ok: false, reason: "invalid-json" });
  const answer = JSON.stringify({ items: [{ text: "Run `smgen deploy`.", source: 1 }] });
  assert.deepEqual(formatGroundedAnswer(answer, sources, "stop"), {
    ok: false,
    reason: "unsupported-content"
  });
});

test("structured answers derive citations from exact technical literals", () => {
  const primary = sources[0];
  assert.ok(primary);
  const other = { ...primary, id: "2", sourceId: "other", content: "SMGen produces HTML." };
  const answer = JSON.stringify({ items: [{ text: "Run `smgen init`.", source: 2 }] });
  assert.deepEqual(formatGroundedAnswer(answer, [primary, other], "stop"), {
    ok: true,
    answer: "- Run `smgen init`. [Source 1]",
    sources: [primary],
    filtered: false
  });
});

test("structured answers retain supported items when other items are unsupported", () => {
  const answer = JSON.stringify({ items: [
    { text: "Run `smgen init`.", source: 1 },
    { text: "Create templates and assets.", source: 1 }
  ] });
  assert.deepEqual(formatGroundedAnswer(answer, sources, "stop"), {
    ok: true,
    answer: "- Run `smgen init`. [Source 1]",
    sources,
    filtered: true
  });
});

test("structured answers fail closed when every item is unsupported", () => {
  const answer = JSON.stringify({ items: [
    { text: "Create templates and assets.", source: 1 },
    { text: "Install Bootstrap.", source: 1 }
  ] });
  assert.deepEqual(formatGroundedAnswer(answer, sources, "stop"), { ok: false, reason: "unsupported-content" });
});

test("structured answers allow connective wording around an exact command", () => {
  const baseSource = sources[0];
  assert.ok(baseSource);
  const commandSource = { ...baseSource, content: "Initialize an empty directory:\n\n`smgen init`" };
  const answer = JSON.stringify({ items: [{ text: "Initialize an empty directory by running `smgen init`.", source: 1 }] });
  assert.deepEqual(formatGroundedAnswer(answer, [commandSource], "stop"), {
    ok: true,
    answer: "- Initialize an empty directory by running `smgen init`. [Source 1]",
    sources: [commandSource],
    filtered: false
  });
});

test("structured answers allow grounded paraphrases with new wording", () => {
  const baseSource = sources[0];
  assert.ok(baseSource);
  const pluginSource = {
    ...baseSource,
    content: "Menu plugins can register a custom renderer for a named menu type."
  };
  const answer = JSON.stringify({ items: [{
    text: "Plugins let authors define additional menu types with their own renderer.",
    source: 1
  }] });
  assert.deepEqual(formatGroundedAnswer(answer, [pluginSource], "stop"), {
    ok: true,
    answer: "- Plugins let authors define additional menu types with their own renderer. [Source 1]",
    sources: [pluginSource],
    filtered: false
  });
});

test("structured answers still reject prose unrelated to its source", () => {
  const answer = JSON.stringify({ items: [{ text: "Bootstrap automatically uploads remote assets.", source: 1 }] });
  assert.deepEqual(formatGroundedAnswer(answer, sources, "stop"), { ok: false, reason: "unsupported-content" });
});

test("extractive fallback adds short command blocks to concise prose", () => {
  const baseSource = sources[0];
  assert.ok(baseSource);
  const source = {
    ...baseSource,
    content: "Initialize an empty directory:\n\n```bash\nmkdir my-site\ncd my-site\n```\n\nSet the site identity in `.smgen-rc`:\n\nBuild and serve the site."
  };
  assert.equal(formatExtractiveAnswer(source), [
    "- Initialize an empty directory: `mkdir my-site`, `cd my-site` [Source 1]",
    "- Set the site identity in `.smgen-rc`: [Source 1]",
    "- Build and serve the site. [Source 1]"
  ].join("\n"));
  assert.deepEqual(validateGroundedAnswer(formatExtractiveAnswer(source), [source], "stop"), { ok: true });
});
