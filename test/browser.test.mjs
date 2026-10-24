// @ts-check

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import {
  adapterCompatibilityIssue,
  createModelAppConfig,
  isCacheNetworkError,
  loadModelWithRetry,
  modelNeedsShaderF16
} from "../src/browser/engine-client.mjs";
import { safeLink } from "../src/browser/render.mjs";

class FakeElement {
  /** @param {string} tagName */
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.hidden = false;
    this.src = "";
    this.textContent = "";
    this.dataset = {};
    this.attributes = new Map();
    this.contentWindow = { postMessage() {}, focus() {} };
    /** @type {Map<string, Function>} */
    this.listeners = new Map();
  }
  /** @param {string} name @param {string} value */
  setAttribute(name, value) { this.attributes.set(name, value); }
  /** @param {string} type @param {Function} listener */
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  /** @param {string} type */
  dispatch(type) { this.listeners.get(type)?.({ type }); }
  focus() {}
}

test("loader does not create or request the iframe before activation", async () => {
  /** @type {FakeElement[]} */
  const appended = [];
  const head = { append: (/** @type {FakeElement} */ element) => appended.push(element) };
  const body = { append: (/** @type {FakeElement} */ element) => appended.push(element) };
  const events = new Map();
  const values = new Map();
  const context = {
    URL,
    location: { href: "https://example.test/project/page.html" },
    sessionStorage: {
      getItem: (/** @type {string} */ key) => values.get(key) ?? null,
      setItem: (/** @type {string} */ key, /** @type {string} */ value) => values.set(key, value)
    },
    document: {
      currentScript: { src: "https://example.test/project/__smgen-assistant/loader.js" },
      title: "Page",
      head,
      body,
      querySelector: () => null,
      createElement: (/** @type {string} */ tag) => new FakeElement(tag)
    },
    window: {
      addEventListener: (/** @type {string} */ type, /** @type {Function} */ listener) => events.set(type, listener)
    }
  };
  const source = await readFile(new URL("../dist/browser/loader.js", import.meta.url), "utf8");
  vm.runInNewContext(source, context);
  assert.deepEqual(appended.map((element) => element.tagName), ["STYLE", "BUTTON"]);
  const button = appended[1];
  button?.dispatch("click");
  assert.deepEqual(appended.map((element) => element.tagName), ["STYLE", "BUTTON", "IFRAME"]);
  assert.equal(appended[2]?.src, "https://example.test/project/__smgen-assistant/frame.html");
});

test("generated Markdown links reject executable schemes", () => {
  assert.equal(safeLink("javascript:alert(1)"), null);
  assert.equal(safeLink("data:text/html,test"), null);
  assert.equal(safeLink("https://example.test/docs"), "https://example.test/docs");
  assert.equal(safeLink("/local.html"), "/local.html");
});

test("model feature detection distinguishes f16 and f32 shader builds", () => {
  assert.equal(modelNeedsShaderF16("Qwen2.5-0.5B-Instruct-q4f16_1-MLC"), true);
  assert.equal(modelNeedsShaderF16("Qwen2.5-0.5B-Instruct-q0f16-MLC"), true);
  assert.equal(modelNeedsShaderF16("Qwen2.5-0.5B-Instruct-q4f32_1-MLC"), false);
});

test("model artifacts use large-file storage without Cache.add", () => {
  const opfs = createModelAppConfig(/** @type {StorageManager} */ ({ getDirectory() {} }));
  assert.equal(opfs.cacheBackend, "opfs");
  assert.equal(opfs.opfsAccessMode, "auto");
  assert.ok(opfs.model_list.length > 0);

  const fallback = createModelAppConfig(undefined);
  assert.equal(fallback.cacheBackend, "indexeddb");
  assert.equal(fallback.opfsAccessMode, undefined);
  assert.equal(fallback.model_list, opfs.model_list);
});

test("adapter checks reject unsupported WebLLM limits before model loading", () => {
  const limits = {
    maxBufferSize: 256 * 1024 * 1024,
    maxStorageBufferBindingSize: 128 * 1024 * 1024,
    maxComputeWorkgroupStorageSize: 32 * 1024,
    maxStorageBuffersPerShaderStage: 10
  };
  const adapter = /** @type {GPUAdapter} */ (/** @type {unknown} */ ({
    features: new Set(),
    limits
  }));
  assert.equal(adapterCompatibilityIssue(adapter, "model-q4f32_1"), null);
  assert.match(adapterCompatibilityIssue(adapter, "model-q4f16_1") ?? "", /shader-f16/u);
  const constrained = /** @type {GPUAdapter} */ (/** @type {unknown} */ ({
    features: new Set(),
    limits: { ...limits, maxBufferSize: 128 * 1024 * 1024 }
  }));
  assert.match(adapterCompatibilityIssue(constrained, "model-q4f32_1") ?? "", /maximum buffer size/u);
});

test("model loading retries only Cache API network failures", async () => {
  let attempts = 0;
  const retryingEngine = /** @type {import('@mlc-ai/web-llm').MLCEngineInterface} */ (/** @type {unknown} */ ({
    reload: async () => {
      attempts += 1;
      if (attempts === 1) throw new DOMException("Cache.add() encountered a network error", "NetworkError");
    }
  }));
  assert.equal(isCacheNetworkError(new DOMException("Cache.add() encountered a network error", "NetworkError")), true);
  await loadModelWithRetry(retryingEngine, "model-q0f32");
  assert.equal(attempts, 2);

  attempts = 0;
  const failingEngine = /** @type {import('@mlc-ai/web-llm').MLCEngineInterface} */ (/** @type {unknown} */ ({
    reload: async () => {
      attempts += 1;
      throw new Error("Device was lost");
    }
  }));
  await assert.rejects(loadModelWithRetry(failingEngine, "model-q0f32"), /Device was lost/u);
  assert.equal(attempts, 1);
});

test("service worker uses the assistant directory as its scope", async () => {
  const source = await readFile(new URL("../src/browser/engine-client.mjs", import.meta.url), "utf8");
  assert.match(source, /new URL\("service-worker\.js", options\.assetBase\)\.href/u);
  assert.match(source, /scope: "\.\/"/u);
  assert.match(source, /controller\?\.scriptURL !== scriptUrl/u);
  assert.match(source, /new ServiceWorkerMLCEngine\(engineConfig, 5000\)/u);
});

test("service worker takes control without waiting for a page reload", async () => {
  const source = await readFile(new URL("../src/browser/service-worker.mjs", import.meta.url), "utf8");
  assert.match(source, /workerScope\.skipWaiting\(\)/u);
  assert.match(source, /workerScope\.clients\.claim\(\)/u);
});
