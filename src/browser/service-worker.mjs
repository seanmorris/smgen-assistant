// @ts-check

import { ServiceWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

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

new ServiceWorkerMLCEngineHandler();

workerScope.addEventListener("install", (event) => {
  event.waitUntil(workerScope.skipWaiting());
});
workerScope.addEventListener("activate", (event) => {
  event.waitUntil(workerScope.clients.claim());
});
