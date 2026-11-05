// @ts-check

import assert from "node:assert/strict";
import test from "node:test";
import { RetrievalClient } from "../src/browser/retrieval-client.mjs";

class FakeWorker extends EventTarget {
  /** @type {FakeWorker[]} */
  static instances = [];
  constructor() {
    super();
    FakeWorker.instances.push(this);
    this.terminated = false;
    /** @type {{id: string, query: string, assetBase: string} | null} */
    this.request = null;
  }
  /** @param {{id: string, query: string, assetBase: string}} request */
  postMessage(request) { this.request = request; }
  terminate() { this.terminated = true; }
  /** @param {Record<string, unknown>} data */
  reply(data) { this.dispatchEvent(new MessageEvent("message", { data: { id: this.request?.id, ...data } })); }
}

/** @param {() => Promise<void>} callback */
async function withWorker(callback) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  Object.defineProperty(globalThis, "Worker", { value: FakeWorker, configurable: true });
  FakeWorker.instances = [];
  try { await callback(); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, "Worker", descriptor);
    else Reflect.deleteProperty(globalThis, "Worker");
  }
}

test("lexical retrieval does not create a worker or download semantic assets", async () => {
  await withWorker(async () => {
    const client = new RetrievalClient(new URL("http://localhost/assistant/"));
    const result = await client.retrieve([], "question", { maxChunks: 2, maxCharacters: 1000 }, "lexical", new AbortController().signal);
    assert.deepEqual(result.chunks, []);
    assert.equal(FakeWorker.instances.length, 0);
  });
});

test("cancelling semantic search terminates inference and a retry uses a fresh worker", async () => {
  await withWorker(async () => {
    const client = new RetrievalClient(new URL("http://localhost/assistant/"));
    const controller = new AbortController();
    const cancelled = assert.rejects(client.search("first", controller.signal, () => {}), { name: "AbortError" });
    const first = FakeWorker.instances[0];
    assert.ok(first);
    controller.abort();
    await cancelled;
    assert.equal(first.terminated, true);
    assert.equal(client.worker, null);
    const next = client.search("retry", new AbortController().signal, () => {});
    const second = FakeWorker.instances[1];
    assert.ok(second);
    second.reply({ type: "result", hits: [], cold: true, indexBytes: 12 });
    assert.deepEqual((await next).hits, []);
    assert.equal(second.terminated, false);
  });
});

test("worker failures reject explicitly instead of reporting lexical fallback as semantic success", async () => {
  await withWorker(async () => {
    const client = new RetrievalClient(new URL("http://localhost/assistant/"));
    const failed = assert.rejects(client.retrieve([], "question", { maxChunks: 2, maxCharacters: 1000 }, "hybrid", new AbortController().signal), /index mismatch/u);
    const worker = FakeWorker.instances[0];
    assert.ok(worker);
    worker.reply({ type: "error", message: "index mismatch" });
    await failed;
    assert.equal(worker.terminated, true);
    assert.equal(client.worker, null);
  });
});
