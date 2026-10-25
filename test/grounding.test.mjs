// @ts-check

import assert from "node:assert/strict";
import test from "node:test";
import { formatExtractiveAnswer, formatExtractiveAnswerSet, formatGeneratedAnswer, formatGroundedAnswer, formatGroundedMarkdown, validateGroundedAnswer } from "../src/shared/grounding.mjs";

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

test("cited Markdown keeps natural paraphrases and compacts its sources", () => {
  const primary = sources[0];
  assert.ok(primary);
  const other = { ...primary, id: "2", sourceId: "other", content: "SMGen produces HTML." };
  assert.deepEqual(formatGroundedMarkdown("- Build a page by running `smgen init`. [Source 1]", [primary, other], "stop"), {
    ok: true,
    answer: "- Build a page by running `smgen init`. [Source 1]",
    sources: [primary],
    filtered: false
  });
});

test("cited Markdown rejects an unrelated claim", () => {
  assert.deepEqual(formatGroundedMarkdown("- Bootstrap uploads remote assets. [Source 1]", sources, "stop"), {
    ok: false,
    reason: "unsupported-content"
  });
});

test("generated prose receives citations from its supporting passages", () => {
  const primary = sources[0];
  assert.ok(primary);
  const other = { ...primary, id: "2", sourceId: "other", content: "SMGen produces static HTML pages." };
  assert.deepEqual(formatGeneratedAnswer([
    "- Initialize the site with `smgen init`.",
    "- SMGen produces static HTML pages."
  ].join("\n"), [primary, other], "stop"), {
    ok: true,
    answer: "- Initialize the site with `smgen init`. [Source 1]\n- SMGen produces static HTML pages. [Source 2]",
    sources: [primary, other],
    filtered: false
  });
});

test("generated prose ignores private reasoning tags from chat templates", () => {
  for (const answer of [
    "<think>Compare the source before answering.</think>\n\n- Initialize the site with `smgen init`.",
    "<think>\n\n</think>\n\n- Initialize the site with `smgen init`.\n\n</think>"
  ]) {
    assert.deepEqual(formatGeneratedAnswer(answer, sources, "stop"), {
      ok: true,
      answer: "- Initialize the site with `smgen init`. [Source 1]",
      sources,
      filtered: false
    });
  }
});

test("generated prose rejects output that contains only private reasoning", () => {
  assert.deepEqual(formatGeneratedAnswer("<think>Consider the documentation.</think>", sources, "stop"), {
    ok: false,
    reason: "empty"
  });
});

test("generated prose drops unsupported claims while keeping grounded bullets", () => {
  assert.deepEqual(formatGeneratedAnswer([
    "- Initialize the site with `smgen init`.",
    "- Bootstrap uploads remote assets."
  ].join("\n"), sources, "stop"), {
    ok: true,
    answer: "- Initialize the site with `smgen init`. [Source 1]",
    sources,
    filtered: true
  });
});

test("generated prose ignores a supplied passage that does not help the answer", () => {
  const primary = sources[0];
  assert.ok(primary);
  const other = { ...primary, id: "2", sourceId: "menus", content: "Use `menus` in page frontmatter." };
  assert.deepEqual(formatGeneratedAnswer("- Initialize the site with `smgen init`.", [primary, other], "stop"), {
    ok: true,
    answer: "- Initialize the site with `smgen init`. [Source 1]",
    sources: [primary],
    filtered: false
  });
});

test("generated prose rejects claims assembled from separate source paragraphs", () => {
  const primary = sources[0];
  assert.ok(primary);
  const source = {
    ...primary,
    content: "Place Markdown pages under `pages/`.\n\nThe watch command rebuilds after a template changes."
  };
  assert.deepEqual(formatGeneratedAnswer("- Copy templates into `pages/`.", [source], "stop"), {
    ok: false,
    reason: "unsupported-content"
  });
});

test("generated prose keeps related facts from one documentation section", () => {
  const primary = sources[0];
  assert.ok(primary);
  const source = {
    ...primary,
    content: [
      "Initialize an empty directory:",
      "```bash\nmkdir my-site\ncd my-site\nsmgen init\n```",
      "Set the site identity in `.smgen-rc`.",
      "Replace `pages/index.md` with your first page.",
      "Build and serve the site with `smgen build` and `smgen serve`.",
      "Open <http://localhost:8000>."
    ].join("\n\n")
  };
  const answer = [
    "- Create an empty directory named `my-site` and navigate into it: `mkdir my-site && cd my-site`",
    "- Initialize SMGen and set the site identity in `.smgen-rc` with `smgen init`.",
    "- Replace `pages/index.md` with your first page and build the site with `smgen build`.",
    "- Serve and view the site using `smgen serve`, then open <http://localhost:8000>"
  ].join("\n");
  const displayed = answer.split("\n").map((line) => `${/[.!?]$/u.test(line) ? line : `${line}.`} [Source 1]`).join("\n");
  assert.deepEqual(formatGeneratedAnswer(answer, [source], "stop"), {
    ok: true,
    answer: displayed,
    sources: [source],
    filtered: false
  });
});

test("generated prose keeps a documented command introduced with generic wording", () => {
  const primary = sources[0];
  assert.ok(primary);
  const source = {
    ...primary,
    content: "Build and serve the site with `smgen build`. On Linux, `smgen watch` builds, serves, and watches the source directories."
  };
  assert.deepEqual(formatGeneratedAnswer(
    "- Use `smgen build` to generate the site or `smgen watch` to build and serve it automatically.",
    [source],
    "stop"
  ), {
    ok: true,
    answer: "- Use `smgen build` to generate the site or `smgen watch` to build and serve it automatically. [Source 1]",
    sources: [source],
    filtered: false
  });
});

test("structured answers accept a JSON fence or short model preface", () => {
  const json = JSON.stringify({ items: [{ text: "Run `smgen init`.", source: 1 }] });
  for (const answer of [`\`\`\`json\n${json}\n\`\`\``, `Here is the answer:\n${json}`]) {
    assert.deepEqual(formatGroundedAnswer(answer, sources, "stop"), {
      ok: true,
      answer: "- Run `smgen init`. [Source 1]",
      sources,
      filtered: false
    });
  }
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
    content: "Initialize an empty directory:\n\n```bash\nmkdir my-site\ncd my-site\n```\n\n…\n\nSet the site identity in `.smgen-rc`:\n\nBuild and serve the site."
  };
  assert.equal(formatExtractiveAnswer(source), [
    "- Initialize an empty directory: `mkdir my-site`, `cd my-site` [Source 1]",
    "- Set the site identity in `.smgen-rc`: [Source 1]",
    "- Build and serve the site. [Source 1]"
  ].join("\n"));
  assert.deepEqual(validateGroundedAnswer(formatExtractiveAnswer(source), [source], "stop"), { ok: true });
});

test("extractive fallback balances multiple sources and skips image markers", () => {
  /** @type {import("../src/shared/types.mjs").CorpusChunk} */
  const first = { id: "1", sourceId: "deploy", title: "Deployment", heading: "Actions", url: "/deployment.html#actions", content: "Configure GitHub Actions.\n\n![Screenshot](/actions.png)\n\nUpload `docs/` as the artifact." };
  /** @type {import("../src/shared/types.mjs").CorpusChunk} */
  const second = { id: "2", sourceId: "url", title: "Deployment", heading: "Public URL", url: "/deployment.html#url", content: "Set `BASE_URL` before the build.\n\nUse the public site root." };
  const extracted = formatExtractiveAnswerSet([first, second]);
  assert.deepEqual(extracted.sources, [first, second]);
  assert.equal(extracted.answer, [
    "- Configure GitHub Actions. [Source 1]",
    "- Upload `docs/` as the artifact. [Source 1]",
    "- Set `BASE_URL` before the build. [Source 2]",
    "- Use the public site root. [Source 2]"
  ].join("\n"));
});

test("question-aware fallback selects feed membership, date order, and missing-date behavior", () => {
  const baseSource = sources[0];
  assert.ok(baseSource);
  const membership = {
    ...baseSource,
    id: "feed-membership",
    heading: "Select Pages",
    content: "Use a list when a page belongs to each named feed:\n\n```yaml\n---\ndate: 2026-10-24T12:30:00Z\nfeeds: [main, releases]\n---\n```\n\nPages without `feeds` do not appear in any RSS feed."
  };
  const dates = {
    ...baseSource,
    id: "feed-dates",
    heading: "Dates and Item Data",
    content: "SMGen chooses an item's publication time in this order:\n\n1. `date`\n2. `created`\n\nA selected page without either field fails the build.\n\nThe default template adds one discovery link for each configured feed."
  };
  const question = "Which frontmatter puts an article in my main and releases RSS feeds, which date does RSS use, and what happens without one?";
  const extracted = formatExtractiveAnswerSet([membership, dates], question);
  assert.match(extracted.answer, /`feeds: \[main, releases\]`/u);
  assert.match(extracted.answer, /publication time in this order: `date`; `created`/u);
  assert.match(extracted.answer, /without either field fails the build/u);
  assert.doesNotMatch(extracted.answer, /discovery link/u);
});

test("question-aware fallback keeps timeline rendering, date, and asset details together", () => {
  const baseSource = sources[0];
  assert.ok(baseSource);
  const timeline = {
    ...baseSource,
    id: "timeline",
    heading: "Timeline Menus",
    content: "A timeline menu renders:\n\n- a linked calendar\n- expandable year and month groups\n\nSMGen chooses dates in this order:\n\n1. `date`\n2. `created`\n3. filesystem birth time\n4. first Git addition time\n5. filesystem modification time\n\nTimeline markup uses native `details` elements. SMGen adds no timeline-specific JavaScript. It links `archive.css` only for a populated rendered timeline."
  };
  const answer = formatExtractiveAnswer(timeline, "How does the calendar group years and months, which dates does it use, and which browser assets load?");
  assert.match(answer, /linked calendar.*expandable year and month groups/u);
  assert.match(answer, /`date`; `created`.*Git addition.*modification time/u);
  assert.match(answer, /no timeline-specific JavaScript.*`archive\.css`/u);
});

test("question-aware fallback preserves configuration order and legacy migration behavior", () => {
  const baseSource = sources[0];
  assert.ok(baseSource);
  const precedence = {
    ...baseSource,
    id: "precedence",
    heading: "Precedence",
    content: "SMGen resolves settings in this order, from lowest to highest:\n\n1. built-in defaults\n2. `.smgen.yaml`\n3. `.smgen.<environment>.yaml`\n4. `.smgen-rc`\n5. `.env`\n6. values exported by the calling process\n\nUse `.smgen-rc` for shell expansion."
  };
  const order = formatExtractiveAnswer(precedence, "My shell value and `.smgen.yaml` disagree. Which one wins?");
  assert.match(order, /lowest to highest: built-in defaults; `.smgen\.yaml`.*values exported by the calling process/u);

  const legacy = {
    ...baseSource,
    id: "legacy",
    heading: "Legacy Navigation",
    content: "Pages without a `menus` field use the original rules:\n\n- `leftBarLink: false` removes the page from the sidebar tree.\n- a page with `date` joins the archive.\n\nPages with a `menus` field use explicit named menu membership instead.\n\nExisting `renderNavBar()` helpers remain usable while a project migrates incrementally."
  };
  const migration = formatExtractiveAnswer(legacy, "Will `leftBarLink` and `renderNavBar()` work while I migrate to named `menus`?");
  assert.match(migration, /`leftBarLink: false`/u);
  assert.match(migration, /explicit named menu membership/u);
  assert.match(migration, /`renderNavBar\(\)` helpers remain usable/u);
});

test("generated prose falls back when it omits the question's documented facts", () => {
  const baseSource = sources[0];
  assert.ok(baseSource);
  const dates = {
    ...baseSource,
    id: "feed-dates",
    heading: "Dates and Item Data",
    content: "SMGen chooses an item's publication time in this order: `date`, then `created`. A selected page without either field fails the build. The default template adds one discovery link for each RSS feed."
  };
  const question = "Which date does RSS use, and what happens without one?";
  assert.deepEqual(formatGeneratedAnswer("The default template adds one discovery link for each RSS feed.", [dates], "stop", question), {
    ok: false,
    reason: "incomplete-answer",
    missing: ["date", "without"]
  });
  assert.equal(formatGeneratedAnswer("SMGen chooses `date`, then `created`, as the publication time. A selected page without either field fails the build.", [dates], "stop", question).ok, true);
});
