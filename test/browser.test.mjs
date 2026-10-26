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
  MAX_RESPONSE_CHARACTERS,
  modelNeedsShaderF16,
  streamAnswer
} from "../src/browser/engine-client.mjs";
import { buildDeviceReport, recommendModel } from "../src/browser/model-selection.mjs";
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
    this.innerHTML = "";
    this.className = "";
    /** @type {Record<string, string>} */
    this.dataset = {};
    /** @type {Record<string, string>} */
    this.style = {};
    /** @type {unknown[]} */
    this.children = [];
    this.offsetWidth = 400;
    this.offsetHeight = 624;
    this.attributes = new Map();
    /** @type {unknown[]} */
    const messages = [];
    this.contentWindow = {
      messages,
      /** Record messages sent to a fake child frame. @param {unknown} message */
      postMessage(message) { messages.push(message); },
      focus() {}
    };
    /** @type {Set<string>} */
    this.classes = new Set();
    this.classList = {
      toggle: (/** @type {string} */ name, /** @type {boolean | undefined} */ force) => {
        const enabled = force ?? !this.classes.has(name);
        if (enabled) this.classes.add(name);
        else this.classes.delete(name);
        return enabled;
      },
      contains: (/** @type {string} */ name) => this.classes.has(name)
    };
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

test("loader verifies model support before showing its deferred launcher", async () => {
  /** @type {FakeElement[]} */
  const appended = [];
  const head = { append: (/** @type {FakeElement} */ element) => appended.push(element) };
  const body = { append: (/** @type {FakeElement} */ element) => appended.push(element) };
  const events = new Map();
  const values = new Map();
  const persistentValues = new Map();
  let hostTheme = "dark";
  /** @type {string[]} */
  const fetched = [];
  /** @type {Function | undefined} */
  let notifyThemeChange;
  const context = {
    URL,
    navigator: {
      deviceMemory: 16,
      gpu: {
        requestAdapter: async () => ({
          features: new Set(),
          limits: {
            maxBufferSize: 512 * 1024 * 1024,
            maxStorageBufferBindingSize: 256 * 1024 * 1024,
            maxComputeWorkgroupStorageSize: 32 * 1024,
            maxStorageBuffersPerShaderStage: 10
          }
        })
      }
    },
    fetch: async (/** @type {URL} */ url, /** @type {RequestInit} */ options = {}) => {
      fetched.push(url.href);
      assert.equal(options.cache, "no-cache");
      return {
        ok: true,
        json: async () => ({
          siteId: "docs-site",
          assetVersion: "browser-build",
          model: { id: "test-model-q4f32_1", label: "Test model" }
        })
      };
    },
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
      documentElement: { classList: { contains: (/** @type {string} */ name) => name === hostTheme } },
      head,
      body,
      querySelector: () => null,
      createElement: (/** @type {string} */ tag) => new FakeElement(tag),
      createTextNode: (/** @type {string} */ value) => ({ tagName: "#TEXT", textContent: value })
    },
    window: {
      innerWidth: 1280,
      innerHeight: 800,
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      addEventListener: (/** @type {string} */ type, /** @type {Function} */ listener) => events.set(type, listener)
    },
    MutationObserver: class {
      /** Retain the observer callback so the test can emulate a host theme toggle. @param {Function} callback */
      constructor(callback) { notifyThemeChange = callback; }
      /** Observe calls do not require a DOM implementation in this host test. */
      observe() {}
    }
  };
  const source = await readFile(new URL("../dist/browser/loader.js", import.meta.url), "utf8");
  vm.runInNewContext(source, context);
  assert.deepEqual(appended.map((element) => element.tagName), ["STYLE", "BUTTON"]);
  const button = appended[1];
  assert.equal(button?.hidden, true);
  assert.match(button?.innerHTML ?? "", /Denis Giffeler/u);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fetched, ["https://example.test/project/__smgen-assistant/config.json"]);
  assert.equal(button?.hidden, false);
  assert.deepEqual(appended.map((element) => element.tagName), ["STYLE", "BUTTON"]);
  button?.dispatch("click");
  await Promise.resolve();
  assert.deepEqual(appended.map((element) => element.tagName), ["STYLE", "BUTTON", "DIV"]);
  const shell = appended[2];
  const frame = /** @type {FakeElement | undefined} */ (shell?.children[0]);
  assert.equal(frame?.tagName, "IFRAME");
  assert.equal(frame?.src, "https://example.test/project/__smgen-assistant/frame.html?site=docs-site&v=browser-build");
  assert.equal(button?.hidden, false);
  assert.equal(button?.attributes.get("aria-expanded"), "true");
  assert.equal(button?.classes.has("is-open"), true);
  assert.equal(shell?.dataset.theme, "dark");
  assert.equal(frame?.style.visibility, "hidden");
  frame?.dispatch("load");
  assert.equal(/** @type {{type?: string, theme?: string}} */ (frame?.contentWindow.messages.at(-1)).type, "smgen-assistant:theme");
  assert.equal(/** @type {{type?: string, theme?: string}} */ (frame?.contentWindow.messages.at(-1)).theme, "dark");
  events.get("message")?.({
    origin: "https://example.test",
    source: frame?.contentWindow,
    data: { type: "smgen-assistant:theme-applied" }
  });
  assert.equal(frame?.style.visibility, "visible");
  events.get("message")?.({
    origin: "https://example.test",
    source: frame?.contentWindow,
    data: { type: "smgen-assistant:activity", active: true }
  });
  assert.equal(button?.classes.has("is-thinking"), true);
  assert.equal(button?.attributes.get("aria-busy"), "true");
  hostTheme = "light";
  notifyThemeChange?.();
  assert.equal(shell?.dataset.theme, "light");
  assert.equal(/** @type {{type?: string, theme?: string}} */ (frame?.contentWindow.messages.at(-1)).theme, "light");
  assert.equal(persistentValues.has("smgen-assistant:size:/project/__smgen-assistant/"), false);
  button?.dispatch("click");
  assert.equal(shell?.hidden, true);
  assert.equal(button?.attributes.get("aria-expanded"), "false");
  assert.equal(button?.classes.has("is-open"), false);
});

test("loader stays hidden when no configured model matches the adapter", async () => {
  /** @type {FakeElement[]} */
  const appended = [];
  const context = {
    URL,
    navigator: {
      deviceMemory: 32,
      gpu: {
        requestAdapter: async () => ({
          features: new Set(),
          limits: {
            maxBufferSize: 512 * 1024 * 1024,
            maxStorageBufferBindingSize: 256 * 1024 * 1024,
            maxComputeWorkgroupStorageSize: 32 * 1024,
            maxStorageBuffersPerShaderStage: 10
          }
        })
      }
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({ model: { id: "f16-only-q4f16_1", label: "f16 only" } })
    }),
    location: { href: "https://example.test/project/page.html" },
    sessionStorage: { getItem: () => "1", setItem() {} },
    localStorage: { getItem: () => null, setItem() {} },
    document: {
      currentScript: { src: "https://example.test/project/__smgen-assistant/loader.js" },
      title: "Page",
      documentElement: { classList: { contains: () => false } },
      head: { append: (/** @type {FakeElement} */ element) => appended.push(element) },
      body: { append: (/** @type {FakeElement} */ element) => appended.push(element) },
      querySelector: () => null,
      createElement: (/** @type {string} */ tag) => new FakeElement(tag)
    },
    window: {
      innerWidth: 1280,
      innerHeight: 800,
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      addEventListener() {}
    },
    MutationObserver: class {
      /** Ignore mutations in this isolated loader test. */
      observe() {}
    }
  };
  const source = await readFile(new URL("../dist/browser/loader.js", import.meta.url), "utf8");
  vm.runInNewContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(appended.map((element) => element.tagName), ["STYLE", "BUTTON"]);
  assert.equal(appended[1]?.hidden, true);
});

test("generated data and browser storage are isolated by site", async () => {
  const loaderSource = await readFile(new URL("../src/browser/loader.mjs", import.meta.url), "utf8");
  const frameSource = await readFile(new URL("../src/browser/frame.mjs", import.meta.url), "utf8");
  assert.match(loaderSource, /cache: "no-cache"/u);
  assert.match(loaderSource, /frameUrl\.searchParams\.set\("site", siteId\)/u);
  assert.match(loaderSource, /frameUrl\.searchParams\.set\("v", loadedConfig\.assetVersion\)/u);
  assert.match(frameSource, /cache: "no-cache"/u);
  assert.match(frameSource, /loadedConfig\.siteId \|\| assetBase\.pathname/u);
  assert.match(frameSource, /configureStorageKeys\(loadedConfig\)/u);
});

test("lotus launcher retains its license metadata and state animation hooks", async () => {
  const svg = await readFile(new URL("../src/browser/lotus.svg", import.meta.url), "utf8");
  const loader = await readFile(new URL("../src/browser/loader.mjs", import.meta.url), "utf8");
  const frame = await readFile(new URL("../src/browser/frame.mjs", import.meta.url), "utf8");
  assert.match(svg, /Denis Giffeler \(Wikimedia Commons user Giffeler\)/u);
  assert.match(svg, /commons\.wikimedia\.org\/wiki\/File:Lotus_flower_animation\.svg/u);
  assert.match(svg, /creativecommons\.org\/licenses\/by\/4\.0/u);
  assert.match(svg, /Modified for smgen-assistant/u);
  assert.match(loader, /is-open \.smgen-lotus-petal/u);
  assert.match(loader, /smgen-lotus-thinking/u);
  assert.match(loader, /smgen-assistant:activity/u);
  assert.match(frame, /reportActivity\(true\)/u);
  assert.match(frame, /reportActivity\(false\)/u);
});

test("loader retires a legacy engine service worker before opening the frame", async () => {
  const source = await readFile(new URL("../src/browser/loader.mjs", import.meta.url), "utf8");
  assert.match(source, /getRegistration\(assetBase\.href\)/u);
  assert.match(source, /worker\.postMessage\(\{ kind: "unload"/u);
  assert.match(source, /await registration\.unregister\(\)/u);
  assert.match(source, /await legacyServiceWorkerRetired/u);
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

test("rendered answers hide a stray Markdown fence saved by an older release", () => {
  const container = new FakeElement("article");
  const doc = /** @type {Document} */ (/** @type {unknown} */ ({
    createElement: (/** @type {string} */ tag) => new FakeElement(tag),
    createTextNode: (/** @type {string} */ value) => ({ tagName: "#TEXT", textContent: value })
  }));
  renderMarkdown(
    /** @type {HTMLElement} */ (/** @type {unknown} */ (container)),
    "- A grounded answer. [Source 1]\n- ```. [Source 1]",
    [{ url: "/guide.html#answer" }],
    doc
  );
  const list = /** @type {FakeElement} */ (container.children[0]);
  assert.equal(list.tagName, "UL");
  assert.equal(list.children.length, 1);
});

test("assistant messages do not inherit the root grid layout", async () => {
  const css = await readFile(new URL("../src/styles/assistant.css", import.meta.url), "utf8");
  assert.match(css, /main\.assistant\s*\{[^}]*display:\s*grid/su);
  assert.doesNotMatch(css, /(?:^|\})\s*\.assistant\s*\{[^}]*display:\s*grid/su);
  assert.match(css, /\.message\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*width:\s*fit-content/su);
  assert.match(css, /\.messages\s*\{[^}]*overflow-x:\s*hidden/su);
});

test("assistant colors use the theme supplied by the host page", async () => {
  const css = await readFile(new URL("../src/styles/assistant.css", import.meta.url), "utf8");
  const frameSource = await readFile(new URL("../src/browser/frame.mjs", import.meta.url), "utf8");
  assert.match(css, /:root\[data-theme="dark"\]\s*\{[^}]*color-scheme:\s*dark/su);
  assert.doesNotMatch(css, /light-dark\(/u);
  assert.match(frameSource, /document\.documentElement\.dataset\.theme = event\.data\.theme/u);
  assert.match(frameSource, /smgen-assistant:theme-applied/u);
});

test("multiple configured models use a persistent deferred picker", async () => {
  const frameSource = await readFile(new URL("../src/browser/frame.mjs", import.meta.url), "utf8");
  const frameHtml = await readFile(new URL("../src/browser/frame.html", import.meta.url), "utf8");
  assert.match(frameHtml, /<select id="model-select"><\/select>/u);
  assert.match(frameSource, /models\.length < 2/u);
  assert.match(frameSource, /localStorage\.setItem\(modelKey, nextModel\.id\)/u);
  assert.match(frameSource, /await module\.releaseAssistantEngine\(previousEngine\)/u);
  assert.match(frameSource, /model: selectedModel/u);
});

test("the composer shares one action slot and keeps the model picker in its footer", async () => {
  const css = await readFile(new URL("../src/styles/assistant.css", import.meta.url), "utf8");
  const frameSource = await readFile(new URL("../src/browser/frame.mjs", import.meta.url), "utf8");
  const frameHtml = await readFile(new URL("../src/browser/frame.html", import.meta.url), "utf8");
  assert.match(frameHtml, /<div class="composer-input">[\s\S]*<textarea[^>]+>[\s\S]*<div class="actions">[\s\S]*id="submit"[\s\S]*id="cancel"[\s\S]*<div class="composer-footer">[\s\S]*id="model-choice"/u);
  assert.match(css, /\.composer-input\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/su);
  assert.match(css, /\.composer-input:has\(textarea:focus\)\s*\{[^}]*outline:\s*3px solid var\(--accent\)/su);
  assert.match(css, /\.composer textarea:focus-visible\s*\{[^}]*outline:\s*0/su);
  assert.match(css, /\.composer textarea\s*\{[^}]*resize:\s*none/su);
  assert.match(css, /\.actions\s*\{[^}]*align-self:\s*center/su);
  assert.match(css, /\.composer \.actions button\s*\{[^}]*grid-area:\s*action[^}]*height:\s*3rem[^}]*width:\s*3rem/su);
  assert.match(css, /\.model-choice select:focus\s*\{[^}]*color:\s*var\(--text\)/su);
  assert.match(css, /\.model-choice option\s*\{[^}]*background:\s*var\(--surface\)[^}]*color:\s*var\(--text\)/su);
  assert.match(css, /\.model-choice option:disabled\s*\{[^}]*color:\s*var\(--muted\)/su);
  assert.match(frameSource, /submitButton\.hidden = Boolean\(generation\);\s*cancelButton\.hidden = !generation;/u);
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
  const appConfig = createModelAppConfig({
    model_list: [{
      model_id: "Qwen2.5-Coder-0.5B-Instruct-q4f32_1-MLC",
      model: "https://example.test/model/",
      model_lib: "https://example.test/v0_2_48/Qwen2-0.5B-Instruct-q4f32_1-webgpu.wasm"
    }]
  });
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

test("model recommendations use compatibility, author quality, and resource estimates", () => {
  const limits = {
    maxBufferSize: 512 * 1024 * 1024,
    maxStorageBufferBindingSize: 256 * 1024 * 1024,
    maxComputeWorkgroupStorageSize: 32 * 1024,
    maxStorageBuffersPerShaderStage: 10
  };
  const f32Adapter = /** @type {GPUAdapter} */ (/** @type {unknown} */ ({
    info: { vendor: "amd", architecture: "", device: "", description: "" },
    features: new Set(),
    limits
  }));
  const f16Adapter = /** @type {GPUAdapter} */ (/** @type {unknown} */ ({
    info: { vendor: "apple", architecture: "apple-m", device: "", description: "" },
    features: new Set(["shader-f16"]),
    limits
  }));
  const models = [
    { id: "fallback-q4f32_1", label: "Fallback", quality: 10, memoryMB: 1900 },
    { id: "strong-q4f32_1", label: "Strong f32", quality: 20, memoryMB: 2600 },
    { id: "strong-q4f16_1", label: "Strong f16", quality: 20, memoryMB: 1900 },
    { id: "largest-q4f16_1", label: "Largest", quality: 30, memoryMB: 3500, requiredFeatures: ["future-feature"] },
    { id: "high-memory-q4f16_1", label: "High memory", quality: 40, memoryMB: 5700, minDeviceMemoryGB: 16 }
  ];
  assert.equal(recommendModel(f32Adapter, models)?.id, "strong-q4f32_1");
  assert.equal(recommendModel(f16Adapter, models)?.id, "strong-q4f16_1");
  assert.equal(recommendModel(f16Adapter, models, 8)?.id, "strong-q4f16_1");
  assert.equal(recommendModel(f16Adapter, models, 32)?.id, "high-memory-q4f16_1");
  assert.match(adapterCompatibilityIssue(
    f16Adapter,
    /** @type {import('../src/shared/types.mjs').AssistantModel} */ (models[4]),
    8
  ) ?? "", /at least 16 GB/u);
  assert.match(adapterCompatibilityIssue(
    f16Adapter,
    /** @type {import('../src/shared/types.mjs').AssistantModel} */ (models[3])
  ) ?? "", /future-feature/u);
  assert.match(adapterCompatibilityIssue(f16Adapter, {
    id: "large-buffer-q4f32_1",
    label: "Large buffer",
    minStorageBufferMB: 300
  }) ?? "", /storage buffer binding size/u);
  const report = buildDeviceReport(f16Adapter, models, 32);
  assert.equal(report.recommendedModelId, "high-memory-q4f16_1");
  assert.deepEqual(/** @type {{features: string[]}} */ (report.adapter).features, ["shader-f16"]);
});

test("model recommendations preserve configured order without quality ranks", () => {
  const adapter = /** @type {GPUAdapter} */ (/** @type {unknown} */ ({
    features: new Set(),
    limits: {
      maxBufferSize: 256 * 1024 * 1024,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
      maxComputeWorkgroupStorageSize: 32 * 1024,
      maxStorageBuffersPerShaderStage: 10
    }
  }));
  const models = [
    { id: "first-q4f32_1", label: "First", memoryMB: 2000 },
    { id: "second-q4f32_1", label: "Second", memoryMB: 1000 }
  ];
  assert.equal(recommendModel(adapter, models)?.id, "first-q4f32_1");
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

test("answer streaming avoids blocking grammar compilation", async () => {
  /** @type {Record<string, unknown> | undefined} */
  let request;
  const engine = /** @type {import('@mlc-ai/web-llm').MLCEngineInterface} */ (/** @type {unknown} */ ({
    interruptGenerate() {},
    chat: { completions: { create: async (/** @type {Record<string, unknown>} */ options) => {
      request = options;
      return (async function* chunks() {
        yield { choices: [{ delta: { content: "Partial" }, finish_reason: null }] };
        yield { choices: [{ delta: {}, finish_reason: "length" }] };
      })();
    } } }
  }));
  let text = "";
  const finishReason = await streamAnswer(
    engine,
    [{ role: "user", content: "Question" }],
    (part) => { text += part; },
    new AbortController().signal
  );
  assert.equal(text, "Partial");
  assert.equal(finishReason, "length");
  assert.deepEqual(request?.stream_options, { include_usage: true });
  assert.equal(request?.temperature, 0);
  assert.equal(request?.top_p, 0.8);
  assert.equal(request?.max_tokens, 256);
  assert.equal(request?.repetition_penalty, undefined);
  assert.equal(request?.frequency_penalty, 0);
  assert.equal(request?.presence_penalty, 0);
  assert.deepEqual(request?.extra_body, { enable_thinking: false });
  assert.equal(request?.response_format, undefined);
});

test("evaluation telemetry requires an explicit frame query", async () => {
  const source = await readFile(new URL("../src/browser/frame.mjs", import.meta.url), "utf8");
  assert.match(source, /searchParams\.get\("evaluation"\) === "1"/u);
  assert.match(source, /smgen-assistant:evaluation-result/u);
  assert.match(source, /rawAnswer/u);
  assert.match(source, /retrievedSources/u);
  assert.match(source, /promptTokens/u);
  assert.match(source, /generationMs/u);
});

test("answer streaming interrupts output too large to pass validation", async () => {
  let interrupted = false;
  const engine = /** @type {import('@mlc-ai/web-llm').MLCEngineInterface} */ (/** @type {unknown} */ ({
    interruptGenerate() { interrupted = true; },
    chat: { completions: { create: async () => (async function* chunks() {
      yield { choices: [{ delta: { content: "x".repeat(MAX_RESPONSE_CHARACTERS + 20) }, finish_reason: null }] };
      yield { choices: [{ delta: { content: "unreachable" }, finish_reason: "stop" }] };
    })() } }
  }));
  let text = "";
  const finishReason = await streamAnswer(
    engine,
    [{ role: "user", content: "Question" }],
    (part) => { text += part; },
    new AbortController().signal
  );
  assert.equal(interrupted, true);
  assert.equal(text.length, MAX_RESPONSE_CHARACTERS);
  assert.equal(finishReason, "length");
});

test("the model uses a dedicated worker and retires older service workers", async () => {
  const source = await readFile(new URL("../src/browser/engine-client.mjs", import.meta.url), "utf8");
  assert.match(source, /new WebWorkerMLCEngine\(worker, engineConfig\)/u);
  assert.match(source, /getRegistration\("\.\/"\)/u);
  assert.match(source, /worker\.postMessage\(\{ kind: "unload"/u);
  assert.match(source, /registration\.unregister\(\)/u);
  assert.doesNotMatch(source, /new ServiceWorkerMLCEngine/u);
});

test("browser worker version matches the package release", async () => {
  const packageMetadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, packageMetadata.version);
});

test("a failed engine is released before retry", async () => {
  const source = await readFile(new URL("../src/browser/frame.mjs", import.meta.url), "utf8");
  assert.match(source, /releaseAssistantEngine\(failedEngine\)/u);
});
