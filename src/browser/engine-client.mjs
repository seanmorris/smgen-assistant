// @ts-check

import { CreateServiceWorkerMLCEngine, CreateWebWorkerMLCEngine } from "@mlc-ai/web-llm";

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
 * Check the selected adapter before WebLLM compiles the model shaders.
 *
 * @param {string} modelId
 */
async function checkModelSupport(modelId) {
  if (!("gpu" in navigator)) throw new Error("This browser does not provide WebGPU.");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("This browser could not find a WebGPU adapter.");
  if (modelNeedsShaderF16(modelId) && !adapter.features.has("shader-f16")) {
    throw new Error("This model requires WebGPU shader-f16 support. Select a q4f32 model for this device.");
  }
}

/**
 * Start WebLLM in the scoped service worker or a dedicated worker fallback.
 *
 * @param {EngineOptions} options
 * @returns {Promise<MLCEngineInterface>}
 */
export async function createAssistantEngine(options) {
  await checkModelSupport(options.modelId);
  const engineConfig = { initProgressCallback: options.onProgress };
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    try {
      const scriptUrl = new URL("service-worker.js", options.assetBase).href;
      await navigator.serviceWorker.register(scriptUrl, {
        scope: "./",
        type: "module",
        updateViaCache: "all"
      });
      await waitForController(scriptUrl, 8000);
      return await CreateServiceWorkerMLCEngine(options.modelId, engineConfig);
    } catch (error) {
      console.warn("smgen-assistant: service worker engine unavailable; using a dedicated worker", error);
    }
  }
  const worker = new Worker(new URL("engine-worker.js", options.assetBase), { type: "module", name: "smgen-assistant" });
  return CreateWebWorkerMLCEngine(worker, options.modelId, engineConfig);
}

/**
 * Stream one completion and interrupt it when the caller aborts.
 *
 * @param {MLCEngineInterface} engine
 * @param {Array<{role: "system" | "user" | "assistant", content: string}>} messages
 * @param {(text: string) => void} onText
 * @param {AbortSignal} signal
 */
export async function streamAnswer(engine, messages, onText, signal) {
  /** Stop the active WebLLM generation request. */
  const stop = () => { void engine.interruptGenerate(); };
  signal.addEventListener("abort", stop, { once: true });
  try {
    const response = await engine.chat.completions.create({
      messages,
      stream: true,
      temperature: 0.2,
      max_tokens: 512
    });
    for await (const chunk of response) {
      if (signal.aborted) break;
      const text = chunk.choices[0]?.delta.content;
      if (text) onText(text);
    }
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
