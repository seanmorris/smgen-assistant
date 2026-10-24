// @ts-check

import { ServiceWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

new ServiceWorkerMLCEngineHandler();

const workerScope = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
workerScope.addEventListener("install", (event) => {
  event.waitUntil(workerScope.skipWaiting());
});
workerScope.addEventListener("activate", (event) => {
  event.waitUntil(workerScope.clients.claim());
});
