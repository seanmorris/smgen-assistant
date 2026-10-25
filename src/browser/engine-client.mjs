// @ts-check

import { prebuiltAppConfig, ServiceWorkerMLCEngine, WebWorkerMLCEngine } from "@mlc-ai/web-llm";
import { VERSION } from "../shared/version.mjs";

/** @typedef {import('@mlc-ai/web-llm').MLCEngineInterface} MLCEngineInterface */
/** @typedef {import('@mlc-ai/web-llm').InitProgressReport} InitProgressReport */

/**
 * Wait for the assistant service worker to replace any broader controller.
 *
 * @param {string} scriptUrl
 * @param {number} timeout
 */
async function waitForController(scriptUrl, timeout) {
  if (navigator.serviceWorker.controller?.scriptURL === scriptUrl) return;
  await new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("service worker did not take control")), timeout);
    /** Resolve after the controller matches the registered assistant worker. */
    const changed = () => {
      if (navigator.serviceWorker.controller?.scriptURL !== scriptUrl) return;
      window.clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      resolve(undefined);
    };
    navigator.serviceWorker.addEventListener("controllerchange", changed);
  });
}

/**
 * @typedef {object} EngineOptions
 * @property {string} modelId
 * @property {URL} assetBase
 * @property {(report: InitProgressReport) => void} onProgress
 * @property {boolean} [forceDedicatedWorker]
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
 * @returns {import('@mlc-ai/web-llm').AppConfig}
 */
export function createModelAppConfig() {
  return { ...prebuiltAppConfig, useIndexedDBCache: true };
}

/**
 * Build a worker URL tied to the installed assistant release.
 *
 * @param {URL} assetBase
 * @param {string} [version]
 * @returns {string}
 */
export function serviceWorkerScriptUrl(assetBase, version = VERSION) {
  const scriptUrl = new URL("service-worker.js", assetBase);
  scriptUrl.searchParams.set("version", version);
  return scriptUrl.href;
}

/**
 * Release a model held by the previous assistant worker before replacing it.
 *
 * @param {string} scriptUrl
 * @param {number} timeout
 * @returns {Promise<void>}
 */
async function unloadPreviousServiceWorker(scriptUrl, timeout) {
  const controller = navigator.serviceWorker.controller;
  if (!controller) return;
  const currentUrl = new URL(controller.scriptURL);
  const nextUrl = new URL(scriptUrl);
  if (currentUrl.origin !== nextUrl.origin || currentUrl.pathname !== nextUrl.pathname || currentUrl.href === nextUrl.href) return;
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
    controller.postMessage({ kind: "unload", uuid: requestId, content: null });
  });
}

/**
 * Ask the active assistant worker whether WebGPU is available in its scope.
 *
 * @param {number} timeout
 * @returns {Promise<boolean>}
 */
async function serviceWorkerHasWebGpu(timeout) {
  const controller = navigator.serviceWorker.controller;
  if (!controller) return false;
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => finish(false), timeout);
    /**
     * Finish the probe and remove its temporary listener.
     *
     * @param {boolean} supported
     */
    function finish(supported) {
      window.clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("message", receive);
      resolve(supported);
    }
    /**
     * Accept the matching capability response from the assistant worker.
     *
     * @param {MessageEvent} event
     */
    function receive(event) {
      if (event.data?.type !== "smgen-assistant:webgpu-result" || event.data.requestId !== requestId) return;
      finish(event.data.supported === true);
    }
    navigator.serviceWorker.addEventListener("message", receive);
    controller.postMessage({ type: "smgen-assistant:check-webgpu", requestId });
  });
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
 * Start WebLLM in the scoped service worker or a dedicated worker fallback.
 *
 * @param {EngineOptions} options
 * @returns {Promise<MLCEngineInterface>}
 */
export async function createAssistantEngine(options) {
  await checkModelSupport(options.modelId);
  const engineConfig = {
    initProgressCallback: options.onProgress,
    appConfig: createModelAppConfig()
  };
  let serviceWorkerReady = false;
  if (!options.forceDedicatedWorker && "serviceWorker" in navigator && location.protocol !== "file:") {
    try {
      const scriptUrl = serviceWorkerScriptUrl(options.assetBase);
      await unloadPreviousServiceWorker(scriptUrl, 2000);
      await navigator.serviceWorker.register(scriptUrl, {
        scope: "./",
        type: "module",
        updateViaCache: "none"
      });
      await waitForController(scriptUrl, 8000);
      serviceWorkerReady = await serviceWorkerHasWebGpu(2000);
    } catch (error) {
      console.warn("smgen-assistant: service worker engine unavailable; using a dedicated worker", error);
    }
  }
  if (serviceWorkerReady) {
    const engine = new ServiceWorkerMLCEngine(engineConfig, 5000);
    try {
      return await loadModelWithRetry(engine, options.modelId);
    } catch (error) {
      await releaseAssistantEngine(engine);
      throw error;
    }
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
  try {
    const response = await engine.chat.completions.create({
      messages,
      stream: true,
      temperature: 0,
      max_tokens: 256,
      repetition_penalty: 1.1,
      frequency_penalty: 0.5,
      response_format: {
        type: "json_object",
        schema: JSON.stringify({
          type: "object",
          properties: {
            items: {
              type: "array",
              minItems: 1,
              maxItems: 4,
              items: {
                type: "object",
                properties: {
                  text: { type: "string", maxLength: 180 },
                  source: { type: "integer", minimum: 1, maximum: 4 }
                },
                required: ["text", "source"],
                additionalProperties: false
              }
            }
          },
          required: ["items"],
          additionalProperties: false
        })
      }
    });
    for await (const chunk of response) {
      if (signal.aborted) break;
      const choice = chunk.choices[0];
      const text = choice?.delta.content;
      if (text) onText(text);
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
