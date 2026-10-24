// @ts-check

import { formatContext, retrieveChunks } from "../shared/retrieval.mjs";
import { renderMarkdown } from "./render.mjs";

/** @typedef {import('../shared/types.mjs').Corpus} Corpus */
/** @typedef {import('../shared/types.mjs').CorpusChunk} CorpusChunk */
/** @typedef {import('../shared/types.mjs').PublicAssistantConfig} PublicAssistantConfig */
/** @typedef {import('@mlc-ai/web-llm').MLCEngineInterface} MLCEngineInterface */

/**
 * @typedef {object} TranscriptMessage
 * @property {"user" | "assistant"} role
 * @property {string} content
 * @property {Array<{title: string, heading: string, url: string}>} [sources]
 */

const assetBase = new URL("./", import.meta.url);
const transcriptKey = `smgen-assistant:transcript:v1:${assetBase.pathname}`;
const titleElement = /** @type {HTMLHeadingElement} */ (document.querySelector("#assistant-title"));
const statusElement = /** @type {HTMLParagraphElement} */ (document.querySelector("#status"));
const consentElement = /** @type {HTMLElement} */ (document.querySelector("#consent"));
const detailsElement = /** @type {HTMLParagraphElement} */ (document.querySelector("#model-details"));
const enableButton = /** @type {HTMLButtonElement} */ (document.querySelector("#enable"));
const progressElement = /** @type {HTMLProgressElement} */ (document.querySelector("#progress"));
const progressLabel = /** @type {HTMLParagraphElement} */ (document.querySelector("#progress-label"));
const messagesElement = /** @type {HTMLElement} */ (document.querySelector("#messages"));
const form = /** @type {HTMLFormElement} */ (document.querySelector("#question-form"));
const questionElement = /** @type {HTMLTextAreaElement} */ (document.querySelector("#question"));
const submitButton = /** @type {HTMLButtonElement} */ (document.querySelector("#submit"));
const cancelButton = /** @type {HTMLButtonElement} */ (document.querySelector("#cancel"));
const closeButton = /** @type {HTMLButtonElement} */ (document.querySelector("#close"));

/** @type {Corpus | null} */
let corpus = null;
/** @type {PublicAssistantConfig | null} */
let config = null;
/** @type {MLCEngineInterface | null} */
let engine = null;
let forceDedicatedWorker = false;
/** @type {AbortController | null} */
let generation = null;
/** @type {{url: string, title: string}} */
let pageContext = { url: "", title: "" };
/** @type {TranscriptMessage[]} */
let transcript = [];

/**
 * Fetch one generated JSON asset from the assistant directory.
 *
 * @template T
 * @param {string} name
 * @returns {Promise<T>}
 */
async function fetchJson(name) {
  const response = await fetch(new URL(name, assetBase), { credentials: "same-origin" });
  if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
  return /** @type {Promise<T>} */ (response.json());
}

/** Save the latest conversation turns for this browser tab. */
function storeTranscript() {
  try {
    sessionStorage.setItem(transcriptKey, JSON.stringify(transcript.slice(-20)));
  } catch {}
}

/** Restore valid conversation turns from this browser tab. */
function restoreTranscript() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(transcriptKey) ?? "[]");
    if (Array.isArray(saved)) transcript = saved.filter((item) =>
      item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string"
    ).slice(-20);
  } catch {}
}

/**
 * Build the separately rendered list of documentation sources.
 *
 * @param {Array<{title: string, heading: string, url: string}>} sources
 */
function sourceList(sources) {
  if (!sources.length) return null;
  const section = document.createElement("section");
  section.className = "sources";
  const label = document.createElement("strong");
  label.textContent = "Documentation used";
  const list = document.createElement("ul");
  const seen = new Set();
  for (const source of sources) {
    const key = `${source.url}\u0000${source.heading}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_top";
    link.rel = "noopener noreferrer";
    link.textContent = source.heading && source.heading !== source.title ? `${source.title}: ${source.heading}` : source.title;
    item.append(link);
    list.append(item);
  }
  section.append(label, list);
  return section;
}

/**
 * Append one conversation turn and its source links to the transcript.
 *
 * @param {TranscriptMessage} message
 * @param {boolean} [scroll]
 */
function appendMessage(message, scroll = true) {
  const article = document.createElement("article");
  article.className = `message ${message.role}`;
  if (message.role === "assistant") renderMarkdown(article, message.content);
  else article.textContent = message.content;
  const sources = sourceList(message.sources ?? []);
  if (sources) article.append(sources);
  messagesElement.append(article);
  if (scroll) article.scrollIntoView({ block: "end" });
  return article;
}

/** Render all restored conversation turns without forcing scroll. */
function renderTranscript() {
  messagesElement.replaceChildren();
  for (const message of transcript) appendMessage(message, false);
}

/** Enable the question controls after the model finishes loading. */
function setReady() {
  questionElement.disabled = false;
  submitButton.disabled = false;
  consentElement.hidden = true;
  statusElement.textContent = "Ready on this device";
  questionElement.focus();
}

/** Load the WebLLM module and model after explicit visitor consent. */
async function enableModel() {
  if (!config || engine) return;
  enableButton.disabled = true;
  progressElement.hidden = false;
  progressLabel.textContent = "Preparing WebLLM…";
  try {
    const module = await import("./engine-client.mjs");
    engine = await module.createAssistantEngine({
      modelId: config.model.id,
      assetBase,
      forceDedicatedWorker,
      onProgress: (report) => {
        progressElement.value = Math.max(0, Math.min(1, report.progress));
        progressLabel.textContent = report.text;
      }
    });
    setReady();
  } catch (error) {
    engine = null;
    forceDedicatedWorker = true;
    enableButton.disabled = false;
    progressElement.hidden = true;
    progressLabel.textContent = error instanceof Error ? error.message : String(error);
    statusElement.textContent = "Model could not start";
  }
}

/**
 * Construct a grounded model conversation from retrieved documentation.
 *
 * @param {CorpusChunk[]} sources
 */
function promptMessages(sources) {
  const recent = transcript.slice(-6).map((message) => ({ role: message.role, content: message.content }));
  return /** @type {Array<{role: "system" | "user" | "assistant", content: string}>} */ ([
    {
      role: "system",
      content: `Answer questions using only the supplied documentation. If the documentation does not contain the answer, say so. Cite supporting passages as [Source 1], [Source 2], and so on. Do not claim to run code, browse the web, or change the page.\n\n${formatContext(sources)}`
    },
    ...recent
  ]);
}

/** Retrieve local context and stream an answer for the current question. */
async function askQuestion() {
  if (!engine || !config || !corpus || generation) return;
  const question = questionElement.value.trim();
  if (!question) return;
  questionElement.value = "";
  const userMessage = /** @type {TranscriptMessage} */ ({ role: "user", content: question });
  transcript.push(userMessage);
  appendMessage(userMessage);
  const sources = retrieveChunks(corpus.chunks, question, {
    ...config.retrieval,
    currentUrl: pageContext.url
  });
  if (!sources.length) {
    const missing = /** @type {TranscriptMessage} */ ({
      role: "assistant",
      content: "I could not find a relevant passage in this site's documentation. Try a more specific term or identifier."
    });
    transcript.push(missing);
    appendMessage(missing);
    storeTranscript();
    return;
  }

  const assistantMessage = /** @type {TranscriptMessage} */ ({
    role: "assistant",
    content: "",
    sources: sources.map(({ title, heading, url }) => ({ title, heading, url }))
  });
  const article = appendMessage(assistantMessage);
  generation = new AbortController();
  questionElement.disabled = true;
  submitButton.disabled = true;
  cancelButton.hidden = false;
  statusElement.textContent = "Writing an answer…";
  try {
    const module = await import("./engine-client.mjs");
    await module.streamAnswer(engine, promptMessages(sources), (text) => {
      assistantMessage.content += text;
      const sourceSection = article.querySelector(".sources");
      renderMarkdown(article, assistantMessage.content);
      if (sourceSection) article.append(sourceSection);
      article.scrollIntoView({ block: "end" });
    }, generation.signal);
    if (!assistantMessage.content) assistantMessage.content = generation.signal.aborted ? "Answer stopped." : "The model returned an empty answer.";
  } catch (error) {
    assistantMessage.content = assistantMessage.content || `The model stopped with an error: ${error instanceof Error ? error.message : String(error)}`;
    if (!generation.signal.aborted) {
      const failedEngine = engine;
      engine = null;
      forceDedicatedWorker = true;
      if (failedEngine) {
        const module = await import("./engine-client.mjs");
        await module.releaseAssistantEngine(failedEngine);
      }
      consentElement.hidden = false;
      enableButton.disabled = false;
      progressElement.hidden = true;
      progressLabel.textContent = "Start the model again to recover from this error.";
    }
  } finally {
    const sourceSection = article.querySelector(".sources");
    renderMarkdown(article, assistantMessage.content);
    if (sourceSection) article.append(sourceSection);
    transcript.push(assistantMessage);
    transcript = transcript.slice(-20);
    storeTranscript();
    generation = null;
    questionElement.disabled = !engine;
    submitButton.disabled = !engine;
    cancelButton.hidden = true;
    statusElement.textContent = engine ? "Ready on this device" : "Model stopped";
    if (engine) questionElement.focus();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void askQuestion();
});
questionElement.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
enableButton.addEventListener("click", () => void enableModel());
cancelButton.addEventListener("click", () => generation?.abort());
closeButton.addEventListener("click", () => window.parent.postMessage({ type: "smgen-assistant:close" }, location.origin));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.parent.postMessage({ type: "smgen-assistant:close" }, location.origin);
});
window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.source !== window.parent || typeof event.data !== "object" || event.data === null) return;
  if (event.data.type === "smgen-assistant:context" && typeof event.data.url === "string" && typeof event.data.title === "string") {
    pageContext = { url: event.data.url, title: event.data.title };
  }
});

/** Load generated data and initialize the inactive assistant interface. */
async function start() {
  try {
    const [loadedConfig, loadedCorpus] = await Promise.all([
      fetchJson("config.json"),
      fetchJson("corpus.json")
    ]);
    config = loadedConfig;
    corpus = loadedCorpus;
    titleElement.textContent = loadedConfig.title;
    detailsElement.textContent = `${loadedConfig.model.label} downloads about ${loadedConfig.model.downloadMB} MB and uses about ${loadedConfig.model.memoryMB} MB of GPU memory.`;
    consentElement.hidden = false;
    if (!("gpu" in navigator)) {
      enableButton.disabled = true;
      progressLabel.textContent = "This browser does not provide WebGPU.";
      statusElement.textContent = "WebGPU unavailable";
    } else {
      statusElement.textContent = "Model is off";
    }
    restoreTranscript();
    if (!transcript.length) transcript.push({ role: "assistant", content: loadedConfig.greeting });
    renderTranscript();
  } catch (error) {
    statusElement.textContent = "Assistant data could not load";
    progressLabel.textContent = error instanceof Error ? error.message : String(error);
    consentElement.hidden = false;
    enableButton.disabled = true;
  } finally {
    window.parent.postMessage({ type: "smgen-assistant:ready" }, location.origin);
    closeButton.focus();
  }
}

void start();
