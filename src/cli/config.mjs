// @ts-check

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

/** @typedef {import('../shared/types.mjs').PublicAssistantConfig} PublicAssistantConfig */
/** @typedef {import('../shared/types.mjs').AssistantModel} AssistantModel */

export const DEFAULT_CONFIG = /** @type {const} */ ({
  title: "Ask this site",
  greeting: "Ask a question about this documentation.",
  model: {
    id: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
    label: "Qwen2.5 1.5B",
    downloadMB: 880,
    memoryMB: 1889
  },
  retrieval: {
    maxChunks: 2,
    maxCharacters: 3000
  },
  chunkCharacters: 4000
});

/**
 * @typedef {object} BuildConfig
 * @property {string} pages
 * @property {string} output
 * @property {string} baseUrl
 * @property {string | undefined} configPath
 * @property {number} chunkCharacters
 * @property {PublicAssistantConfig} publicConfig
 */

/**
 * Normalize a deployment prefix to an absolute path without a trailing slash.
 *
 * @param {string} value
 * @returns {string}
 */
export function normalizeBaseUrl(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  if (/[?#]/u.test(trimmed)) {
    throw new Error("BASE_URL must not include a query string or fragment");
  }
  let pathname = trimmed;
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(trimmed)) {
    const parsed = new URL(trimmed);
    pathname = parsed.pathname;
  }
  const pieces = pathname.split("/").filter(Boolean);
  if (pieces.some((piece) => piece === "." || piece === "..")) {
    throw new Error("BASE_URL must not contain dot segments");
  }
  return `/${pieces.join("/")}`;
}

/**
 * Return a mapping when the input can safely be treated as one.
 *
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function objectValue(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * Validate an optional string and substitute its default value.
 *
 * @param {unknown} value
 * @param {string} name
 * @param {string} fallback
 */
function optionalString(value, name, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a nonempty string`);
  }
  return value.trim();
}

/**
 * Validate an optional positive integer and substitute its default value.
 *
 * @param {unknown} value
 * @param {string} name
 * @param {number} fallback
 */
function optionalPositiveInteger(value, name, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return /** @type {number} */ (value);
}

/**
 * Validate an optional positive integer without inventing an estimate.
 *
 * @param {unknown} value
 * @param {string} name
 * @returns {number | undefined}
 */
function optionalModelMetric(value, name) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return /** @type {number} */ (value);
}

/**
 * Validate an optional list of WebGPU feature names.
 *
 * @param {unknown} value
 * @param {string} name
 * @returns {string[] | undefined}
 */
function optionalFeatureList(value, name) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${name} must be a nonempty sequence`);
  }
  const features = value.map((feature, index) => optionalString(feature, `${name}[${index}]`, ""));
  if (new Set(features).size !== features.length) throw new Error(`${name} must not contain duplicates`);
  return features;
}

/**
 * Validate one WebLLM model choice.
 *
 * @param {unknown} value
 * @param {string} name
 * @param {AssistantModel | undefined} [fallback]
 * @returns {AssistantModel}
 */
function modelOption(value, name, fallback) {
  if (value === undefined && fallback) return { ...fallback };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be a mapping`);
  }
  const model = /** @type {Record<string, unknown>} */ (value);
  const id = model.id === undefined
    ? fallback?.id
    : optionalString(model.id, `${name}.id`, fallback?.id ?? "");
  if (!id) throw new Error(`${name}.id must be a nonempty string`);
  const usesFallback = id === fallback?.id;
  const label = optionalString(model.label, `${name}.label`, usesFallback ? (fallback?.label ?? id) : id);
  const downloadMB = model.downloadMB === undefined && usesFallback
    ? fallback?.downloadMB
    : optionalModelMetric(model.downloadMB, `${name}.downloadMB`);
  const memoryMB = model.memoryMB === undefined && usesFallback
    ? fallback?.memoryMB
    : optionalModelMetric(model.memoryMB, `${name}.memoryMB`);
  const quality = model.quality === undefined && usesFallback
    ? fallback?.quality
    : optionalModelMetric(model.quality, `${name}.quality`);
  const requiredFeatures = model.requiredFeatures === undefined && usesFallback
    ? fallback?.requiredFeatures
    : optionalFeatureList(model.requiredFeatures, `${name}.requiredFeatures`);
  const minStorageBufferMB = model.minStorageBufferMB === undefined && usesFallback
    ? fallback?.minStorageBufferMB
    : optionalModelMetric(model.minStorageBufferMB, `${name}.minStorageBufferMB`);
  return {
    id,
    label,
    ...(downloadMB === undefined ? {} : { downloadMB }),
    ...(memoryMB === undefined ? {} : { memoryMB }),
    ...(quality === undefined ? {} : { quality }),
    ...(requiredFeatures === undefined ? {} : { requiredFeatures }),
    ...(minStorageBufferMB === undefined ? {} : { minStorageBufferMB })
  };
}

/**
 * Normalize the legacy single model and the selectable model list.
 *
 * @param {Record<string, unknown>} fileConfig
 * @returns {AssistantModel[]}
 */
function modelOptions(fileConfig) {
  if (fileConfig.models !== undefined && fileConfig.model !== undefined) {
    throw new Error("configure either model or models, not both");
  }
  if (fileConfig.models !== undefined) {
    if (!Array.isArray(fileConfig.models) || fileConfig.models.length === 0) {
      throw new Error("models must be a nonempty sequence");
    }
    const models = fileConfig.models.map((value, index) => modelOption(value, `models[${index}]`));
    const ids = new Set(models.map(({ id }) => id));
    if (ids.size !== models.length) throw new Error("models must not contain duplicate IDs");
    return models;
  }
  return [modelOption(fileConfig.model, "model", DEFAULT_CONFIG.model)];
}

/**
 * Parse the YAML configuration file as a top-level mapping.
 *
 * @param {string} filename
 * @returns {Promise<Record<string, unknown>>}
 */
async function readConfigFile(filename) {
  const source = await readFile(filename, "utf8");
  const parsed = parseYaml(source);
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${filename} must contain a YAML mapping`);
  }
  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * Resolve command-line, YAML, environment, and default build settings.
 *
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} [environment]
 * @param {string} [cwd]
 * @returns {Promise<{help: true} | {help: false, config: BuildConfig}>}
 */
export async function parseBuildOptions(argv, environment = process.env, cwd = process.cwd()) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) return { help: true };
  const command = argv[0];
  if (command !== "build") throw new Error(`unknown command: ${command ?? ""}`);

  /** @type {Record<string, string>} */
  const flags = {};
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag?.startsWith("--")) throw new Error(`unexpected argument: ${flag ?? ""}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (!["--pages", "--output", "--base-url", "--config"].includes(flag)) {
      throw new Error(`unknown option: ${flag}`);
    }
    if (flag !== "--base-url" && !value) throw new Error(`${flag} requires a nonempty value`);
    flags[flag] = value;
    index += 1;
  }

  let configPath = flags["--config"] ? path.resolve(cwd, flags["--config"]) : undefined;
  if (!configPath) {
    const candidate = path.join(cwd, ".smgen-assistant.yaml");
    try {
      await access(candidate);
      configPath = candidate;
    } catch {}
  }
  const fileConfig = configPath ? await readConfigFile(configPath) : {};
  const models = modelOptions(fileConfig);
  const model = /** @type {AssistantModel} */ (models[0]);
  const retrieval = objectValue(fileConfig.retrieval);
  const pagesValue = flags["--pages"] ?? fileConfig.pages ?? "./pages";
  const outputValue = flags["--output"] ?? fileConfig.output ?? "./docs";
  const baseUrlValue = flags["--base-url"] ?? fileConfig.baseUrl ?? environment.BASE_URL ?? "";
  if (typeof pagesValue !== "string" || !pagesValue.trim()) throw new Error("pages must be a nonempty path");
  if (typeof outputValue !== "string" || !outputValue.trim()) throw new Error("output must be a nonempty path");
  if (typeof baseUrlValue !== "string") throw new Error("baseUrl must be a string");

  return {
    help: false,
    config: {
      pages: path.resolve(cwd, pagesValue),
      output: path.resolve(cwd, outputValue),
      baseUrl: normalizeBaseUrl(baseUrlValue),
      configPath,
      chunkCharacters: optionalPositiveInteger(fileConfig.chunkCharacters, "chunkCharacters", DEFAULT_CONFIG.chunkCharacters),
      publicConfig: {
        version: 1,
        title: optionalString(fileConfig.title, "title", DEFAULT_CONFIG.title),
        greeting: optionalString(fileConfig.greeting, "greeting", DEFAULT_CONFIG.greeting),
        model,
        models,
        retrieval: {
          maxChunks: optionalPositiveInteger(retrieval.maxChunks, "retrieval.maxChunks", DEFAULT_CONFIG.retrieval.maxChunks),
          maxCharacters: optionalPositiveInteger(retrieval.maxCharacters, "retrieval.maxCharacters", DEFAULT_CONFIG.retrieval.maxCharacters)
        }
      }
    }
  };
}
