// @ts-check

import { createHash } from "node:crypto";
import { access, chmod, cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../shared/version.mjs";
import { buildCorpus } from "./corpus.mjs";

/** @typedef {import('./config.mjs').BuildConfig} BuildConfig */

/**
 * Report whether one canonical path contains another canonical path.
 *
 * @param {string} parent
 * @param {string} child
 */
function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/**
 * Reject a symbolic link at a generated output boundary.
 *
 * @param {string} filename
 */
async function rejectSymlink(filename) {
  try {
    if ((await lstat(filename)).isSymbolicLink()) throw new Error(`output path must not be a symbolic link: ${filename}`);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") throw error;
  }
}

/**
 * Serialize generated data in a stable, readable form with a final newline.
 *
 * @param {unknown} value
 */
function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Create a short deterministic identifier for generated browser data.
 *
 * @param {unknown} value
 */
function contentId(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 20);
}

/**
 * Add the generated asset version to frame-owned static resources.
 *
 * @param {string} html
 * @param {string} assetVersion
 */
function versionFrameAssets(html, assetVersion) {
  const query = `?v=${encodeURIComponent(assetVersion)}`;
  return html
    .replace('href="assistant.css"', `href="assistant.css${query}"`)
    .replace('src="frame.js"', `src="frame.js${query}"`);
}

/**
 * Locate compiled browser assets from installed and source checkouts.
 *
 * @returns {Promise<string>}
 */
async function resolveBrowserAssets() {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const installed = path.resolve(moduleDirectory, "../browser");
  try {
    await access(path.join(installed, "loader.js"));
    return installed;
  } catch {
    const checkout = path.resolve(moduleDirectory, "../../dist/browser");
    await access(path.join(checkout, "loader.js"));
    return checkout;
  }
}

/**
 * Build the corpus and install all assistant assets with rollback on failure.
 *
 * @param {BuildConfig} config
 * @returns {Promise<{pages: number, chunks: number, destination: string}>}
 */
export async function buildSiteAssistant(config) {
  await rejectSymlink(config.pages);
  await rejectSymlink(config.output);
  const pages = await realpath(config.pages);
  await mkdir(config.output, { recursive: true });
  const output = await realpath(config.output);
  if (contains(pages, output) || contains(output, pages)) {
    throw new Error("pages and output directories must not overlap");
  }

  const destination = path.join(output, "__smgen-assistant");
  await rejectSymlink(destination);
  const stage = await mkdtemp(path.join(output, ".smgen-assistant-stage-"));
  const backup = `${stage}-previous`;
  let backedUp = false;
  try {
    const corpus = await buildCorpus(pages, {
      baseUrl: config.baseUrl,
      chunkCharacters: config.chunkCharacters,
      renderedDirectory: output
    });
    const siteId = contentId({
      baseUrl: config.baseUrl,
      title: config.publicConfig.title,
      sources: corpus.sources
    });
    const assetVersion = contentId({
      packageVersion: VERSION,
      config: config.publicConfig,
      corpus
    });
    const publicConfig = { ...config.publicConfig, siteId, assetVersion };
    const browserAssets = await resolveBrowserAssets();
    await cp(browserAssets, stage, { recursive: true, force: true });
    const framePath = path.join(stage, "frame.html");
    await writeFile(framePath, versionFrameAssets(await readFile(framePath, "utf8"), assetVersion), "utf8");
    await writeFile(path.join(stage, "corpus.json"), stableJson(corpus), "utf8");
    await writeFile(path.join(stage, "config.json"), stableJson(publicConfig), "utf8");
    await chmod(stage, 0o755);

    try {
      await rename(destination, backup);
      backedUp = true;
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") throw error;
    }
    try {
      await rename(stage, destination);
    } catch (error) {
      if (backedUp) {
        try {
          await rename(backup, destination);
          backedUp = false;
        } catch (restoreError) {
          throw new AggregateError([error, restoreError], `assistant installation failed; previous output remains at ${backup}`);
        }
      }
      throw error;
    }
    if (backedUp) {
      await rm(backup, { recursive: true, force: true });
      backedUp = false;
    }
    return { pages: corpus.sources.length, chunks: corpus.chunks.length, destination };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
