// @ts-check

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
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

test("service worker uses the assistant directory as its scope", async () => {
  const source = await readFile(new URL("../src/browser/engine-client.mjs", import.meta.url), "utf8");
  assert.match(source, /new URL\("service-worker\.js", options\.assetBase\)\.href/u);
  assert.match(source, /scope: "\.\/"/u);
  assert.match(source, /controller\?\.scriptURL !== scriptUrl/u);
});
