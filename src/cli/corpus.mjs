// @ts-check

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { chunkMarkdown } from "../shared/chunk.mjs";

/** @typedef {import('../shared/types.mjs').Corpus} Corpus */
/** @typedef {import('../shared/types.mjs').CorpusChunk} CorpusChunk */
/** @typedef {import('../shared/types.mjs').CorpusSource} CorpusSource */

/**
 * Derive a short deterministic identifier from source text.
 *
 * @param {string} value
 */
function stableId(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/**
 * Separate YAML frontmatter from the Markdown supplied to retrieval.
 *
 * @param {string} source
 * @param {string} filename
 * @returns {{attributes: Record<string, unknown>, markdown: string}}
 */
export function parseFrontmatter(source, filename) {
  const normalized = source.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  if (!normalized.startsWith("---\n")) return { attributes: {}, markdown: normalized };
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) throw new Error(`${filename} has an unclosed frontmatter block`);
  const raw = normalized.slice(4, end);
  const parsed = parseYaml(raw);
  if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed))) {
    throw new Error(`${filename} frontmatter must be a YAML mapping`);
  }
  return {
    attributes: /** @type {Record<string, unknown>} */ (parsed ?? {}),
    markdown: normalized.slice(end + 5).replace(/^\n/u, "")
  };
}

/**
 * Read directory metadata in plain YAML or frontmatter-delimited form.
 *
 * @param {string} filename
 * @returns {Promise<Record<string, unknown>>}
 */
async function readDirectoryMetadata(filename) {
  const parsed = parseFrontmatter(await readFile(filename, "utf8"), filename);
  if (parsed.markdown.trim()) {
    const direct = parseYaml(await readFile(filename, "utf8"));
    if (direct !== null && (typeof direct !== "object" || Array.isArray(direct))) {
      throw new Error(`${filename} must contain a YAML mapping`);
    }
    return /** @type {Record<string, unknown>} */ (direct ?? {});
  }
  return parsed.attributes;
}

/**
 * Find Markdown pages in byte-sorted order without following symbolic links.
 *
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function listMarkdown(root) {
  /** @type {string[]} */
  const files = [];
  /**
   * Visit one source directory and append its Markdown files.
   *
   * @param {string} directory
   */
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symbolic links are not allowed in pages: ${filename}`);
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(filename);
    }
  }
  await visit(root);
  return files;
}

/**
 * Merge root-to-leaf .fm.yaml files for a page directory.
 *
 * @param {string} root
 * @param {string} pageDirectory
 * @returns {Promise<Record<string, unknown>>}
 */
async function inheritedMetadata(root, pageDirectory) {
  const relative = path.relative(root, pageDirectory);
  const segments = relative ? relative.split(path.sep) : [];
  /** @type {Record<string, unknown>} */
  let metadata = {};
  let current = root;
  for (const segment of ["", ...segments]) {
    if (segment) current = path.join(current, segment);
    const filename = path.join(current, ".fm.yaml");
    try {
      const stat = await lstat(filename);
      if (stat.isSymbolicLink()) throw new Error(`symbolic links are not allowed in pages: ${filename}`);
      if (!stat.isFile()) throw new Error(`${filename} must be a regular file`);
      metadata = { ...metadata, ...(await readDirectoryMetadata(filename)) };
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") throw error;
    }
  }
  return metadata;
}

/**
 * Find the first level-one heading outside a fenced code block.
 *
 * @param {string} markdown
 * @param {string} fallback
 */
function firstHeading(markdown, fallback) {
  let fence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s{0,3}(`{3,}|~{3,})/u.test(line)) {
      fence = !fence;
      continue;
    }
    const match = !fence ? line.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/u) : null;
    if (match?.[1]) return match[1].trim();
  }
  return fallback;
}

/**
 * Map an SMGen source path or explicit override to its public page URL.
 *
 * @param {string} baseUrl
 * @param {string} relative
 * @param {Record<string, unknown>} metadata
 */
function pageUrl(baseUrl, relative, metadata) {
  const explicit = metadata.assistantUrl ?? metadata.url;
  if (typeof explicit === "string" && explicit.trim()) {
    if (/^[a-z][a-z\d+.-]*:\/\//iu.test(explicit)) return explicit;
    return `/${explicit.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
  }
  const htmlPath = relative.replace(/\.md$/iu, ".html").split(path.sep).map(encodeURIComponent).join("/");
  return `${baseUrl}/${htmlPath}`.replace(/\/{2,}/gu, "/");
}

/**
 * Convert all eligible Markdown pages into deterministic sources and chunks.
 *
 * @param {string} pagesDirectory
 * @param {{baseUrl: string, chunkCharacters: number}} options
 * @returns {Promise<Corpus>}
 */
export async function buildCorpus(pagesDirectory, options) {
  const pagesRoot = await realpath(pagesDirectory);
  const rootStat = await lstat(pagesRoot);
  if (!rootStat.isDirectory()) throw new Error(`pages is not a directory: ${pagesDirectory}`);
  /** @type {CorpusSource[]} */
  const sources = [];
  /** @type {CorpusChunk[]} */
  const chunks = [];

  for (const filename of await listMarkdown(pagesRoot)) {
    const relative = path.relative(pagesRoot, filename);
    const parsed = parseFrontmatter(await readFile(filename, "utf8"), filename);
    const metadata = { ...(await inheritedMetadata(pagesRoot, path.dirname(filename))), ...parsed.attributes };
    if (metadata.assistant === false) continue;
    const fallback = path.basename(relative, path.extname(relative)).replace(/[-_]+/gu, " ");
    const titleValue = metadata.title ?? metadata.pagetitle;
    const title = typeof titleValue === "string" && titleValue.trim()
      ? titleValue.trim()
      : firstHeading(parsed.markdown, fallback);
    const url = pageUrl(options.baseUrl, relative, metadata);
    const sourceId = stableId(relative.split(path.sep).join("/"));
    sources.push({ id: sourceId, title, url });
    const pageChunks = chunkMarkdown(parsed.markdown, title, options.chunkCharacters);
    pageChunks.forEach((chunk, index) => {
      chunks.push({
        id: `${sourceId}-${String(index + 1).padStart(3, "0")}`,
        sourceId,
        title,
        url,
        heading: chunk.heading,
        content: chunk.content
      });
    });
  }
  return { version: 1, sources, chunks };
}
