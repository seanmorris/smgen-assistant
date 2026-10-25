// @ts-check

export const MAX_RESPONSE_CHARACTERS = 1200;

/** @typedef {import('@mlc-ai/web-llm').MLCEngineInterface} MLCEngineInterface */
/** @typedef {import('@mlc-ai/web-llm').InitProgressReport} InitProgressReport */

/**
 * @typedef {object} EngineOptions
 * @property {string} modelId
 * @property {URL} assetBase
 * @property {(report: InitProgressReport) => void} onProgress
 */

/**
 * Report whether a WebLLM model name selects half-precision shaders.
 *
 * @param {string} modelId
 * @returns {boolean}
 */
export function modelNeedsShaderF16(modelId) {
  return /-q\d+f16(?:_|-|$)/iu.test(modelId);
}

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
 * Find a WebLLM runtime requirement that the adapter cannot meet.
 *
 * @param {GPUAdapter} adapter
 * @param {string} modelId
 * @returns {string | null}
 */
export function adapterCompatibilityIssue(adapter, modelId) {
  const mebibyte = 1024 * 1024;
  const checks = [
    ["maximum buffer size", adapter.limits.maxBufferSize, 256 * mebibyte],
    ["maximum storage buffer binding size", adapter.limits.maxStorageBufferBindingSize, 128 * mebibyte],
    ["compute workgroup storage", adapter.limits.maxComputeWorkgroupStorageSize, 32 * 1024],
    ["storage buffers per shader stage", adapter.limits.maxStorageBuffersPerShaderStage, 10]
  ];
  for (const [label, available, required] of checks) {
    if (/** @type {number} */ (available) < /** @type {number} */ (required)) {
      return `This WebGPU adapter provides insufficient ${label} for WebLLM.`;
    }
  }
  if (modelNeedsShaderF16(modelId) && !adapter.features.has("shader-f16")) {
    return "This model requires WebGPU shader-f16 support. Select a q4f32 model for this device.";
  }
  return null;
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
 * @param {string} modelId
 */
async function checkModelSupport(modelId) {
  if (!("gpu" in navigator)) throw new Error("This browser does not provide WebGPU.");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("This browser could not find a WebGPU adapter.");
  const issue = adapterCompatibilityIssue(adapter, modelId);
  if (issue) throw new Error(issue);
}

/**
 * Start WebLLM in a dedicated worker.
 *
 * @param {EngineOptions} options
 * @returns {Promise<MLCEngineInterface>}
 */
export async function createAssistantEngine(options) {
  await checkModelSupport(options.modelId);
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
    return await loadModelWithRetry(engine, options.modelId);
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
 * @returns {Promise<string | null>}
 */
export async function streamAnswer(engine, messages, onText, signal) {
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
      presence_penalty: 0
    });
    for await (const chunk of response) {
      if (signal.aborted) break;
      if (chunk.usage) console.debug("smgen-assistant: generation performance", chunk.usage);
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
