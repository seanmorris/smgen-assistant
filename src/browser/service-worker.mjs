// @ts-check

import { ServiceWorkerMLCEngineHandler } from "@mlc-ai/web-llm";
import { handleAssistantWorkerMessage } from "./prompt-tokens.mjs";

const workerScope = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
workerScope.addEventListener("message", (event) => {
  if (event.data?.type !== "smgen-assistant:check-webgpu") return;
  event.waitUntil((async () => {
    const workerNavigator = /** @type {WorkerNavigator & {gpu?: GPU}} */ (workerScope.navigator);
    const adapter = await workerNavigator.gpu?.requestAdapter();
    event.source?.postMessage({
      type: "smgen-assistant:webgpu-result",
      requestId: event.data.requestId,
      supported: Boolean(adapter)
    });
  })());
});

class AssistantServiceWorkerHandler extends ServiceWorkerMLCEngineHandler {
  /**
   * Route assistant requests before delegating to WebLLM.
   *
   * @param {ExtendableMessageEvent} event
   * @param {(value: unknown) => void} [onComplete]
   * @param {() => void} [onError]
   */
  onmessage(event, onComplete, onError) {
    const handler = /** @type {ServiceWorkerMLCEngineHandler & {
     *   engine: unknown,
     *   handleTask: (uuid: string, task: () => Promise<number>) => Promise<void>,
     *   reloadIfUnmatched: (modelId: string[], chatOpts?: unknown[]) => Promise<void>
     * }} */ (/** @type {unknown} */ (this));
    handleAssistantWorkerMessage({
      engine: handler.engine,
      handleTask: handler.handleTask.bind(this),
      reloadIfUnmatched: handler.reloadIfUnmatched.bind(this),
      onmessage: super.onmessage.bind(this)
    }, event, onComplete, onError);
  }
}

new AssistantServiceWorkerHandler();

workerScope.addEventListener("install", (event) => {
  event.waitUntil(workerScope.skipWaiting());
});
workerScope.addEventListener("activate", (event) => {
  event.waitUntil(workerScope.clients.claim());
});
