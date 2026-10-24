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
  modelNeedsShaderF16,
  serviceWorkerScriptUrl
} from "../src/browser/engine-client.mjs";
import { countRuntimePromptTokens } from "../src/browser/prompt-tokens.mjs";
import { renderMarkdown, safeLink } from "../src/browser/render.mjs";
import { VERSION } from "../src/shared/version.mjs";

class FakeElement {
  /** @param {string} tagName */
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.hidden = false;
    this.src = "";
    this.href = "";
    this.textContent = "";
    this.className = "";
    this.dataset = {};
    this.style = {};
    /** @type {unknown[]} */
    this.children = [];
    this.offsetWidth = 400;
    this.offsetHeight = 624;
    this.attributes = new Map();
    this.contentWindow = { postMessage() {}, focus() {} };
    this.classList = { toggle() {} };
    /** @type {Map<string, Function>} */
    this.listeners = new Map();
  }
  /** @param {string} name @param {string} value */
  setAttribute(name, value) { this.attributes.set(name, value); }
  /** @param {...unknown} children */
  append(...children) { this.children.push(...children); }
  /** @param {...unknown} children */
  replaceChildren(...children) { this.children = [...children]; }
  /** @param {string} type @param {Function} listener */
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  /** @param {string} type */
  removeEventListener(type) { this.listeners.delete(type); }
  /** @param {string} type */
  dispatch(type) { this.listeners.get(type)?.({ type, currentTarget: this }); }
  /** @param {number} _pointerId */
  setPointerCapture(_pointerId) {}
  focus() {}
}

test("loader does not create or request the iframe before activation", async () => {
  /** @type {FakeElement[]} */
  const appended = [];
  const head = { append: (/** @type {FakeElement} */ element) => appended.push(element) };
  const body = { append: (/** @type {FakeElement} */ element) => appended.push(element) };
  const events = new Map();
  const values = new Map();
  const persistentValues = new Map();
  const context = {
    URL,
    location: { href: "https://example.test/project/page.html" },
    sessionStorage: {
      getItem: (/** @type {string} */ key) => values.get(key) ?? null,
      setItem: (/** @type {string} */ key, /** @type {string} */ value) => values.set(key, value)
    },
    localStorage: {
      getItem: (/** @type {string} */ key) => persistentValues.get(key) ?? null,
      setItem: (/** @type {string} */ key, /** @type {string} */ value) => persistentValues.set(key, value)
    },
    document: {
      currentScript: { src: "https://example.test/project/__smgen-assistant/loader.js" },
      title: "Page",
      head,
      body,
      querySelector: () => null,
      createElement: (/** @type {string} */ tag) => new FakeElement(tag),
      createTextNode: (/** @type {string} */ value) => ({ tagName: "#TEXT", textContent: value })
    },
    window: {
      innerWidth: 1280,
      innerHeight: 800,
      addEventListener: (/** @type {string} */ type, /** @type {Function} */ listener) => events.set(type, listener)
    }
  };
  const source = await readFile(new URL("../dist/browser/loader.js", import.meta.url), "utf8");
  vm.runInNewContext(source, context);
  assert.deepEqual(appended.map((element) => element.tagName), ["STYLE", "BUTTON"]);
  const button = appended[1];
  button?.dispatch("click");
  assert.deepEqual(appended.map((element) => element.tagName), ["STYLE", "BUTTON", "DIV"]);
  const shell = appended[2];
  const frame = /** @type {FakeElement | undefined} */ (shell?.children[0]);
  assert.equal(frame?.tagName, "IFRAME");
  assert.equal(frame?.src, "https://example.test/project/__smgen-assistant/frame.html");
  assert.equal(persistentValues.has("smgen-assistant:size:/project/__smgen-assistant/"), false);
});

test("generated Markdown links reject executable schemes", () => {
  assert.equal(safeLink("javascript:alert(1)"), null);
  assert.equal(safeLink("data:text/html,test"), null);
  assert.equal(safeLink("https://example.test/docs"), "https://example.test/docs");
  assert.equal(safeLink("/local.html"), "/local.html");
});

test("documentation citations link to exact source fragments", () => {
  const container = new FakeElement("article");
  const doc = /** @type {Document} */ (/** @type {unknown} */ ({
    createElement: (/** @type {string} */ tag) => new FakeElement(tag),
    createTextNode: (/** @type {string} */ value) => ({ tagName: "#TEXT", textContent: value })
  }));
  renderMarkdown(
    /** @type {HTMLElement} */ (/** @type {unknown} */ (container)),
    "Follow the setup steps. [Source 1] [Source 8]",
    [{ url: "/guide.html#setup" }],
    doc
  );
  const paragraph = /** @type {FakeElement} */ (container.children[0]);
  const links = /** @type {FakeElement[]} */ (paragraph.children.filter((child) => child instanceof FakeElement && child.tagName === "A"));
  assert.equal(links[0]?.href, "/guide.html#setup");
  assert.equal(links.length, 1);
});

test("assistant messages do not inherit the root grid layout", async () => {
  const css = await readFile(new URL("../src/styles/assistant.css", import.meta.url), "utf8");
  assert.match(css, /main\.assistant\s*\{[^}]*display:\s*grid/su);
  assert.doesNotMatch(css, /(?:^|\})\s*\.assistant\s*\{[^}]*display:\s*grid/su);
  assert.match(css, /\.message\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*width:\s*fit-content/su);
  assert.match(css, /\.messages\s*\{[^}]*overflow-x:\s*hidden/su);
});

test("prompt counting uses the loaded tokenizer and conversation template", () => {
  class FakeConversation {
    /** @param {unknown} config */
    constructor(config) {
      this.config = /** @type {{system_prefix_token_ids: number[]}} */ (config);
      this.override_system_message = "";
      /** @type {string[]} */
      this.messages = [];
    }
    /** @param {string} role @param {string} content */
    appendMessage(role, content) { this.messages.push(`${role}:${content}`); }
    /** @param {string} role */
    appendReplyHeader(role) { this.messages.push(`${role}:`); }
    /** Return the formatted prompt segments. */
    getPromptArray() { return [`system:${this.override_system_message}`, ...this.messages]; }
  }
  const config = { system_prefix_token_ids: [1, 2] };
  const runtime = {
    loadedModelIdToPipeline: new Map([["model", {
      tokenizer: { encode: (/** @type {string} */ value) => [...value] },
      getConversationObject: () => new FakeConversation(config)
    }]])
  };
  const messages = [
    { role: /** @type {const} */ ("system"), content: "rules" },
    { role: /** @type {const} */ ("user"), content: "question" }
  ];
  const formatted = ["system:rules", "user:question", "assistant:"];
  assert.equal(countRuntimePromptTokens(runtime, messages), 2 + formatted.join("").length);
});

test("model feature detection distinguishes f16 and f32 shader builds", () => {
  assert.equal(modelNeedsShaderF16("Qwen2.5-0.5B-Instruct-q4f16_1-MLC"), true);
  assert.equal(modelNeedsShaderF16("Qwen2.5-0.5B-Instruct-q0f16-MLC"), true);
  assert.equal(modelNeedsShaderF16("Qwen2.5-0.5B-Instruct-q4f32_1-MLC"), false);
});

test("model artifacts use large-file storage without Cache.add", () => {
  const appConfig = createModelAppConfig();
  assert.equal(appConfig.useIndexedDBCache, true);
  const model = appConfig.model_list.find((/** @type {import('@mlc-ai/web-llm').ModelRecord} */ record) => (
    record.model_id === "Qwen2.5-Coder-0.5B-Instruct-q4f32_1-MLC"
  ));
  assert.match(model?.model_lib ?? "", /\/v0_2_48\/Qwen2-0\.5B-Instruct-q4f32_1/u);
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
  /** @type {import('@mlc-ai/web-llm').ChatOptions | undefined} */
  let receivedOptions;
  const retryingEngine = /** @type {import('@mlc-ai/web-llm').MLCEngineInterface} */ (/** @type {unknown} */ ({
    reload: async (
      /** @type {string | string[]} */ _modelId,
      /** @type {import('@mlc-ai/web-llm').ChatOptions | import('@mlc-ai/web-llm').ChatOptions[] | undefined} */ chatOptions
    ) => {
      attempts += 1;
      receivedOptions = Array.isArray(chatOptions) ? chatOptions[0] : chatOptions;
      if (attempts === 1) throw new DOMException("Cache.add() encountered a network error", "NetworkError");
    }
  }));
  assert.equal(isCacheNetworkError(new DOMException("Cache.add() encountered a network error", "NetworkError")), true);
  await loadModelWithRetry(retryingEngine, "model-q0f32");
  assert.equal(attempts, 2);
  assert.equal(receivedOptions?.context_window_size, 2048);

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
  assert.match(source, /scope: "\.\/"/u);
  assert.match(source, /controller\?\.scriptURL !== scriptUrl/u);
  assert.match(source, /new ServiceWorkerMLCEngine\(engineConfig, 5000\)/u);
  assert.match(source, /updateViaCache: "none"/u);
  assert.match(source, /controller\.postMessage\(\{ kind: "unload"/u);
  assert.equal(
    serviceWorkerScriptUrl(
      new URL("https://example.test/docs/__smgen-assistant/"),
      "0.1.7"
    ),
    "https://example.test/docs/__smgen-assistant/service-worker.js?version=0.1.7"
  );
});

test("browser worker version matches the package release", async () => {
  const packageMetadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, packageMetadata.version);
});

test("service worker takes control without waiting for a page reload", async () => {
  const source = await readFile(new URL("../src/browser/service-worker.mjs", import.meta.url), "utf8");
  assert.match(source, /workerScope\.skipWaiting\(\)/u);
  assert.match(source, /workerScope\.clients\.claim\(\)/u);
  assert.match(source, /smgen-assistant:check-webgpu/u);
});

test("a failed service worker engine retries in a dedicated worker", async () => {
  const source = await readFile(new URL("../src/browser/frame.mjs", import.meta.url), "utf8");
  assert.match(source, /forceDedicatedWorker = true/u);
  assert.match(source, /releaseAssistantEngine\(failedEngine\)/u);
});
