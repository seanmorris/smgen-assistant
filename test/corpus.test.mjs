// @ts-check

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCorpus, parseFrontmatter, renderedHeadingFragments } from "../src/cli/corpus.mjs";
import { chunkMarkdown } from "../src/shared/chunk.mjs";

test("frontmatter is removed from model context", () => {
  const result = parseFrontmatter("---\ntitle: Page\n---\n# Page\n\nText\n", "page.md");
  assert.equal(result.attributes.title, "Page");
  assert.equal(result.markdown, "# Page\n\nText\n");
  assert.doesNotMatch(result.markdown, /title:/u);
});

test("frontmatter accepts a closing delimiter at end of file", () => {
  const result = parseFrontmatter("---\ntitle: Directory\n---", ".fm.yaml");
  assert.equal(result.attributes.title, "Directory");
  assert.equal(result.markdown, "");
});

test("corpus applies inherited metadata and excludes opted-out pages", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "smgen-assistant-corpus-"));
  try {
    await mkdir(path.join(root, "guides"));
    await writeFile(path.join(root, ".fm.yaml"), "assistant: true\n");
    await writeFile(path.join(root, "guides", ".fm.yaml"), "---\nsection: Guides\n---\n");
    await writeFile(path.join(root, "guides", "start.md"), "---\ntitle: Start here\n---\n# Start\n\nUse `widget.start()`.\n");
    await writeFile(path.join(root, "secret.md"), "---\nassistant: false\n---\n# Secret\n\nDo not index.\n");
    const first = await buildCorpus(root, { baseUrl: "/manual", chunkCharacters: 4000 });
    const second = await buildCorpus(root, { baseUrl: "/manual", chunkCharacters: 4000 });
    assert.deepEqual(first, second);
    assert.deepEqual(first.sources.map((source) => source.title), ["Start here"]);
    assert.equal(first.sources[0]?.url, "/manual/guides/start.html");
    assert.match(first.chunks[0]?.content ?? "", /widget\.start/u);
    assert.doesNotMatch(JSON.stringify(first), /Do not index/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corpus publishes directory routes without changing similar filenames", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "smgen-assistant-directory-routes-"));
  try {
    await mkdir(path.join(root, "games"));
    await writeFile(path.join(root, "index.md"), "# Home\n");
    await writeFile(path.join(root, "games", "index.md"), "# Games\n");
    await writeFile(path.join(root, "api-phonics-spatial-bounds-index.md"), "# API Index\n");
    const corpus = await buildCorpus(root, { baseUrl: "/manual", chunkCharacters: 4000 });
    assert.deepEqual(corpus.sources.map((source) => source.url), [
      "/manual/api-phonics-spatial-bounds-index.html",
      "/manual/games/",
      "/manual/"
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corpus uses SMGen manifest outputs for generated pages", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "smgen-assistant-generated-routes-"));
  const output = await mkdtemp(path.join(os.tmpdir(), "smgen-assistant-generated-output-"));
  try {
    const generated = path.join(root, ".smgen-generated", "phpdoc", "api", "index.md");
    const manifest = path.join(root, "pages.tsv");
    await mkdir(path.dirname(generated), { recursive: true });
    await mkdir(path.join(output, "api"), { recursive: true });
    await writeFile(generated, "# Generated API\n\nGenerated reference details.\n");
    await writeFile(path.join(output, "api", "index.html"), '<h1 id="generated-api">Generated API</h1>\n');
    await writeFile(manifest, `api/index.html\t${generated}\n`);
    const corpus = await buildCorpus(root, {
      baseUrl: "/manual",
      chunkCharacters: 4000,
      renderedDirectory: output,
      pageManifest: manifest
    });
    assert.equal(corpus.sources[0]?.url, "/manual/api/");
    assert.equal(corpus.chunks[0]?.url, "/manual/api/#generated-api");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(output, { recursive: true, force: true });
  }
});

test("corpus rejects symlinks instead of following them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "smgen-assistant-links-"));
  const outside = path.join(root, "..", `${path.basename(root)}-outside.md`);
  try {
    await writeFile(outside, "# Outside\n");
    await symlink(outside, path.join(root, "linked.md"));
    await assert.rejects(buildCorpus(root, { baseUrl: "", chunkCharacters: 4000 }), /symbolic links/u);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { force: true });
  }
});

test("corpus reports the page containing an invalid intent annotation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "smgen-assistant-intent-error-"));
  try {
    await writeFile(path.join(root, "broken.md"), "<!-- <how> -->\nText without a closing annotation.\n");
    await assert.rejects(buildCorpus(root, { baseUrl: "", chunkCharacters: 4000 }), /broken\.md: Intent annotation <how> is not closed/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("heading chunking does not split a fenced code block", () => {
  const code = Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n");
  const chunks = chunkMarkdown(`# API\n\nBefore.\n\n## Example\n\n\`\`\`js\n${code}\n\`\`\`\n\nAfter.`, "API", 80);
  const codeChunks = chunks.filter((chunk) => chunk.content.includes("```js"));
  assert.equal(codeChunks.length, 1);
  assert.match(codeChunks[0]?.content ?? "", /line 29\n```/u);
  assert.equal(codeChunks[0]?.heading, "API > Example");
});

test("corpus source URLs target identifiers from generated HTML", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "smgen-assistant-fragments-"));
  const output = await mkdtemp(path.join(os.tmpdir(), "smgen-assistant-output-"));
  try {
    await writeFile(path.join(root, "guide.md"), "# API & Setup\n\nFollow the instructions.\n");
    await writeFile(path.join(output, "guide.html"), "<main><h1 id=\"api-setup\">API &amp; Setup</h1></main>");
    const corpus = await buildCorpus(root, { baseUrl: "/manual", chunkCharacters: 4000, renderedDirectory: output });
    assert.equal(corpus.chunks[0]?.url, "/manual/guide.html#api-setup");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(output, { recursive: true, force: true });
  }
});

test("heading fragments honor explicit IDs and remain unique", () => {
  const chunks = chunkMarkdown("# Same\n\nOne.\n\n# Same\n\nTwo.\n\n## Named {#chosen}\n\nThree.", "Page");
  assert.deepEqual(chunks.map((chunk) => chunk.fragment), ["same", "same-1", "chosen"]);
  assert.doesNotMatch(chunks[2]?.heading ?? "", /\{#chosen\}/u);
});

test("intent annotations split chunks and remain outside source text", () => {
  const chunks = chunkMarkdown(`# Widgets

<!-- <what keywords="component, gadget"> -->
A widget is a configured page component.
<!-- </what> -->

<!-- <how keywords='install, first setup'> -->
Run \`widget init\`, then edit \`widget.yaml\`.
<!-- </how> -->`, "Widgets");
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0]?.intents, ["what"]);
  assert.deepEqual(chunks[0]?.keywords, ["component", "gadget"]);
  assert.deepEqual(chunks[1]?.intents, ["how"]);
  assert.deepEqual(chunks[1]?.keywords, ["install", "first setup"]);
  assert.doesNotMatch(JSON.stringify(chunks), /<!--|<what|<how/u);
});

test("intent annotations may nest and must close in order", () => {
  const chunks = chunkMarkdown(`<!-- <what> -->
Definition.
<!-- <why> -->
Reason.
<!-- </why> -->
More definition.
<!-- </what> -->`, "Page");
  assert.deepEqual(chunks.map(({ intents }) => intents), [["what"], ["what", "why"], ["what"]]);
  assert.throws(() => chunkMarkdown("<!-- <how> -->\nText\n<!-- </what> -->", "Page"), /cannot close/u);
  assert.throws(() => chunkMarkdown("<!-- <where> -->\nText", "Page"), /not closed/u);
});

test("intent-like comments in fenced code remain literal source", () => {
  const [chunk] = chunkMarkdown("```md\n<!-- <how> -->\n```", "Page");
  assert.equal(chunk?.intents, undefined);
  assert.match(chunk?.content ?? "", /<!-- <how> -->/u);
});

test("rendered heading matching ignores headings in code fences", () => {
  const fragments = renderedHeadingFragments(
    "# Real\n\n```md\n# Not a heading\n```\n\n## Child\n",
    "<h1 id=\"real\">Real</h1><h2 id=\"child-id\">Child</h2>"
  );
  assert.deepEqual(fragments, ["real", "child-id"]);
});
