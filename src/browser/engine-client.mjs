// @ts-check

import { adapterCompatibilityIssue } from "./model-selection.mjs";

export const MAX_RESPONSE_CHARACTERS = 1200;

/** @typedef {import('@mlc-ai/web-llm').MLCEngineInterface} MLCEngineInterface */
/** @typedef {import('@mlc-ai/web-llm').InitProgressReport} InitProgressReport */
/** @typedef {import('../shared/types.mjs').AssistantModel} AssistantModel */

/**
 * @typedef {object} EngineOptions
 * @property {AssistantModel} model
 * @property {URL} assetBase
 * @property {(report: InitProgressReport) => void} onProgress
 */

export { adapterCompatibilityIssue, modelNeedsShaderF16 } from "./model-selection.mjs";

/**
 * Build WebLLM's model configuration with IndexedDB artifact storage.
 *
 * @param {import('@mlc-ai/web-llm').AppConfig} prebuiltConfig
 * @returns {import('@mlc-ai/web-llm').AppConfig}
 */
export function createModelAppConfig(prebuiltConfig) {
  return { ...prebuiltConfig, useIndexedDBCache: true };
}

/**
 * Normalize a model repository URL the same way WebLLM addresses its artifacts.
 *
 * @param {string} modelUrl
 * @returns {string}
 */
function cleanModelUrl(modelUrl) {
  let normalized = modelUrl.endsWith("/") ? modelUrl : `${modelUrl}/`;
  if (!/.+\/resolve\/.+\//u.test(normalized)) normalized += "resolve/main/";
  return new URL(normalized).href;
}

/**
 * Delete matching URL records from one WebLLM IndexedDB artifact store.
 *
 * @param {string} databaseName
 * @param {(url: string) => boolean} matches
 * @returns {Promise<number>}
 */
async function deleteIndexedDbArtifacts(databaseName, matches) {
  const databases = await indexedDB.databases();
  if (!databases.some(({ name }) => name === databaseName)) return 0;
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`Could not open ${databaseName}.`));
  });
  const typedDatabase = /** @type {IDBDatabase} */ (database);
  if (!typedDatabase.objectStoreNames.contains("urls")) {
    typedDatabase.close();
    return 0;
  }
  try {
    return await new Promise((resolve, reject) => {
      let deleted = 0;
      const transaction = typedDatabase.transaction("urls", "readwrite");
      const request = transaction.objectStore("urls").openCursor();
      transaction.oncomplete = () => resolve(deleted);
      transaction.onerror = () => reject(transaction.error ?? new Error(`Could not clean ${databaseName}.`));
      request.onerror = () => reject(request.error ?? new Error(`Could not inspect ${databaseName}.`));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const value = /** @type {{url?: unknown}} */ (cursor.value);
        if (typeof value.url === "string" && matches(value.url)) {
          cursor.delete();
          deleted += 1;
        }
        cursor.continue();
      };
    });
  } finally {
    typedDatabase.close();
  }
}

/**
 * Count matching URL records in one WebLLM IndexedDB artifact store.
 *
 * @param {string} databaseName
 * @param {(url: string) => boolean} matches
 * @returns {Promise<number>}
 */
async function countIndexedDbArtifacts(databaseName, matches) {
  const databases = await indexedDB.databases();
  if (!databases.some(({ name }) => name === databaseName)) return 0;
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`Could not open ${databaseName}.`));
  });
  const typedDatabase = /** @type {IDBDatabase} */ (database);
  if (!typedDatabase.objectStoreNames.contains("urls")) {
    typedDatabase.close();
    return 0;
  }
  try {
    return await new Promise((resolve, reject) => {
      let count = 0;
      const transaction = typedDatabase.transaction("urls", "readonly");
      const request = transaction.objectStore("urls").openCursor();
      transaction.oncomplete = () => resolve(count);
      transaction.onerror = () => reject(transaction.error ?? new Error(`Could not inspect ${databaseName}.`));
      request.onerror = () => reject(request.error ?? new Error(`Could not inspect ${databaseName}.`));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const value = /** @type {{url?: unknown}} */ (cursor.value);
        if (typeof value.url === "string" && matches(value.url)) count += 1;
        cursor.continue();
      };
    });
  } finally {
    typedDatabase.close();
  }
}

/**
 * Remove a broken artifact database that lacks WebLLM's expected object store.
 *
 * @param {string} databaseName
 * @returns {Promise<void>}
 */
async function removeStorelessIndexedDb(databaseName) {
  const databases = await indexedDB.databases();
  if (!databases.some(({ name }) => name === databaseName)) return;
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`Could not open ${databaseName}.`));
  });
  const typedDatabase = /** @type {IDBDatabase} */ (database);
  const valid = typedDatabase.objectStoreNames.contains("urls");
  typedDatabase.close();
  if (valid) return;
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve(undefined);
    request.onerror = () => reject(request.error ?? new Error(`Could not repair ${databaseName}.`));
    request.onblocked = () => reject(new Error(`Could not repair ${databaseName} because it is still open.`));
  });
}

/**
 * Remove one model's weights, tokenizer, configuration, and WebAssembly artifact from disk.
 *
 * @param {string} modelId
 * @returns {Promise<{deletedRecords: number, remainingRecords: number}>}
 */
export async function deleteAssistantModelFromDisk(modelId) {
  const { deleteModelAllInfoInCache, prebuiltAppConfig } = await import("@mlc-ai/web-llm");
  const appConfig = createModelAppConfig(prebuiltAppConfig);
  const records = /** @type {Array<{model_id: string, model: string, model_lib: string}>} */ (appConfig.model_list);
  const record = records.find(({ model_id: candidate }) => candidate === modelId);
  if (!record) throw new Error(`WebLLM does not recognize model ${modelId}.`);
  const modelUrl = cleanModelUrl(record.model);
  /** Report whether an IndexedDB key belongs to the selected model repository. */
  const matchesModel = (/** @type {string} */ url) => url.startsWith(modelUrl);
  /** Report whether an IndexedDB key is the selected model's WebAssembly module. */
  const matchesWasm = (/** @type {string} */ url) => url === record.model_lib;
  await Promise.all([
    removeStorelessIndexedDb("webllm/model"),
    removeStorelessIndexedDb("webllm/config"),
    removeStorelessIndexedDb("webllm/wasm")
  ]);
  await deleteModelAllInfoInCache(modelId, appConfig);
  const deleted = await Promise.all([
    deleteIndexedDbArtifacts("webllm/model", matchesModel),
    deleteIndexedDbArtifacts("webllm/config", matchesModel),
    deleteIndexedDbArtifacts("webllm/wasm", matchesWasm)
  ]);
  const remaining = await Promise.all([
    countIndexedDbArtifacts("webllm/model", matchesModel),
    countIndexedDbArtifacts("webllm/config", matchesModel),
    countIndexedDbArtifacts("webllm/wasm", matchesWasm)
  ]);
  const remainingRecords = remaining.reduce((total, count) => total + count, 0);
  if (remainingRecords) throw new Error(`${remainingRecords} cached records remain for ${modelId}.`);
  return {
    deletedRecords: deleted.reduce((total, count) => total + count, 0),
    remainingRecords
  };
}

/**
 * Retire a model held by an older assistant service worker release.
 *
 * @param {URL} assetBase
 * @param {number} timeout
 * @returns {Promise<void>}
 */
async function retireAssistantServiceWorker(assetBase, timeout) {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("./");
  const worker = registration?.active ?? registration?.waiting ?? registration?.installing;
  if (!registration || !worker) return;
  const currentUrl = new URL(worker.scriptURL);
  const assistantUrl = new URL("service-worker.js", assetBase);
  if (currentUrl.origin !== assistantUrl.origin || currentUrl.pathname !== assistantUrl.pathname) return;
  const requestId = crypto.randomUUID();
  await new Promise((resolve) => {
    const timer = window.setTimeout(finish, timeout);
    /** Remove the temporary listener after a response or timeout. */
    function finish() {
      window.clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("message", receive);
      resolve(undefined);
    }
    /**
     * Finish when the previous WebLLM handler answers the unload request.
     *
     * @param {MessageEvent} event
     */
    function receive(event) {
      if (event.data?.uuid === requestId && (event.data.kind === "return" || event.data.kind === "throw")) finish();
    }
    navigator.serviceWorker.addEventListener("message", receive);
    worker.postMessage({ kind: "unload", uuid: requestId, content: null });
  });
  await registration.unregister();
}

/**
 * Report whether a model load failed during a Cache API network request.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isCacheNetworkError(error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /(?:NetworkError.*Cache\.add|Cache\.add.*network error)/iu.test(message);
}

/**
 * Load a model and resume once after a transient Cache API network failure.
 *
 * @param {MLCEngineInterface} engine
 * @param {string} modelId
 * @param {import('@mlc-ai/web-llm').ChatOptions} [chatOptions]
 * @returns {Promise<MLCEngineInterface>}
 */
export async function loadModelWithRetry(engine, modelId, chatOptions = { context_window_size: 2048 }) {
  try {
    await engine.reload(modelId, chatOptions);
  } catch (error) {
    if (!isCacheNetworkError(error)) throw error;
    await engine.reload(modelId, chatOptions);
  }
  return engine;
}

/**
 * Release a failed engine and terminate its dedicated worker when present.
 *
 * @param {MLCEngineInterface} engine
 * @returns {Promise<void>}
 */
export async function releaseAssistantEngine(engine) {
  try {
    await Promise.race([
      engine.unload(),
      new Promise((resolve) => window.setTimeout(resolve, 1500))
    ]);
  } catch {}
  const workerEngine = /** @type {MLCEngineInterface & {worker?: {terminate?: () => void}}} */ (engine);
  workerEngine.worker?.terminate?.();
}

/**
 * Check the selected adapter before WebLLM compiles the model shaders.
 *
 * @param {AssistantModel} model
 */
async function checkModelSupport(model) {
  if (!("gpu" in navigator)) throw new Error("This browser does not provide WebGPU.");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("This browser could not find a WebGPU adapter.");
  const issue = adapterCompatibilityIssue(adapter, model);
  if (issue) throw new Error(issue);
}

/**
 * Start WebLLM in a dedicated worker.
 *
 * @param {EngineOptions} options
 * @returns {Promise<MLCEngineInterface>}
 */
export async function createAssistantEngine(options) {
  await checkModelSupport(options.model);
  const { prebuiltAppConfig, WebWorkerMLCEngine } = await import("@mlc-ai/web-llm");
  const engineConfig = {
    initProgressCallback: options.onProgress,
    appConfig: createModelAppConfig(prebuiltAppConfig)
  };
  try {
    await retireAssistantServiceWorker(options.assetBase, 1500);
  } catch (error) {
    console.warn("smgen-assistant: could not retire the previous service worker", error);
  }
  const worker = new Worker(new URL("engine-worker.js", options.assetBase), { type: "module", name: "smgen-assistant" });
  const engine = new WebWorkerMLCEngine(worker, engineConfig);
  try {
    return await loadModelWithRetry(engine, options.model.id);
  } catch (error) {
    await releaseAssistantEngine(engine);
    throw error;
  }
}

/**
 * Stream one completion and interrupt it when the caller aborts.
 *
 * @param {MLCEngineInterface} engine
 * @param {Array<{role: "system" | "user" | "assistant", content: string}>} messages
 * @param {(text: string) => void} onText
 * @param {AbortSignal} signal
 * @param {(usage: {completion_tokens: number, prompt_tokens: number, total_tokens: number, extra: Record<string, unknown>}) => void} [onUsage]
 * @returns {Promise<string | null>}
 */
export async function streamAnswer(engine, messages, onText, signal, onUsage) {
  /** Stop the active WebLLM generation request. */
  const stop = () => { void engine.interruptGenerate(); };
  signal.addEventListener("abort", stop, { once: true });
  let finishReason = null;
  let generatedCharacters = 0;
  try {
    const response = await engine.chat.completions.create({
      messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0,
      top_p: 0.8,
      max_tokens: 256,
      frequency_penalty: 0,
      presence_penalty: 0,
      extra_body: { enable_thinking: false }
    });
    for await (const chunk of response) {
      if (signal.aborted) break;
      if (chunk.usage) {
        console.debug("smgen-assistant: generation performance", chunk.usage);
        onUsage?.(chunk.usage);
      }
      const choice = chunk.choices[0];
      const text = choice?.delta.content;
      if (text) {
        const remaining = MAX_RESPONSE_CHARACTERS - generatedCharacters;
        if (remaining > 0) onText(text.slice(0, remaining));
        generatedCharacters += text.length;
        if (generatedCharacters > MAX_RESPONSE_CHARACTERS) {
          void engine.interruptGenerate();
          return "length";
        }
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
    }
    return finishReason;
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

/**
 * Count a chat prompt with the tokenizer already loaded in the WebLLM worker.
 *
 * @param {MLCEngineInterface} engine
 * @param {Array<{role: "system" | "user" | "assistant", content: string}>} messages
 * @returns {Promise<number>}
 */
export async function countPromptTokens(engine, messages) {
  const client = /** @type {MLCEngineInterface & {
   *   modelId?: string[],
   *   chatOpts?: import('@mlc-ai/web-llm').ChatOptions[],
   *   getPromise: (request: unknown) => Promise<number>
   * }} */ (engine);
  return client.getPromise({
    kind: "customRequest",
    uuid: crypto.randomUUID(),
    content: {
      requestName: "smgen-assistant:count-prompt",
      requestMessage: JSON.stringify({ messages, modelId: client.modelId ?? [], chatOpts: client.chatOpts })
    }
  });
}

/**
 * Identify prompt-size validation failures reported by WebLLM.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isContextWindowError(error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /ContextWindowSizeExceededError|context window size|prompt.*too (?:long|large)/iu.test(message);
}
