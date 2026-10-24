// @ts-check

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCorpus, parseFrontmatter } from "../src/cli/corpus.mjs";
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

test("heading chunking does not split a fenced code block", () => {
  const code = Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n");
  const chunks = chunkMarkdown(`# API\n\nBefore.\n\n## Example\n\n\`\`\`js\n${code}\n\`\`\`\n\nAfter.`, "API", 80);
  const codeChunks = chunks.filter((chunk) => chunk.content.includes("```js"));
  assert.equal(codeChunks.length, 1);
  assert.match(codeChunks[0]?.content ?? "", /line 29\n```/u);
  assert.equal(codeChunks[0]?.heading, "API > Example");
});
