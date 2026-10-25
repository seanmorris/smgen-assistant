// @ts-check

import { retrieveChunks } from "../shared/retrieval.mjs";
import { formatExtractiveAnswer, formatGroundedAnswer } from "../shared/grounding.mjs";
import { fitPrompt, MAX_QUESTION_CHARACTERS } from "../shared/prompt.mjs";
import { renderMarkdown } from "./render.mjs";

/** @typedef {import('../shared/types.mjs').Corpus} Corpus */
/** @typedef {import('../shared/types.mjs').CorpusChunk} CorpusChunk */
/** @typedef {import('../shared/types.mjs').PublicAssistantConfig} PublicAssistantConfig */
/** @typedef {import('@mlc-ai/web-llm').MLCEngineInterface} MLCEngineInterface */

/**
 * @typedef {object} SourceLink
 * @property {string} title
 * @property {string} heading
 * @property {string} url
 */

/**
 * @typedef {object} TranscriptMessage
 * @property {"user" | "assistant"} role
 * @property {string} content
 * @property {SourceLink[]} [sources]
 * @property {string} [excerpt]
 */

const assetBase = new URL("./", import.meta.url);
const transcriptKey = `smgen-assistant:transcript:v3:${assetBase.pathname}`;
const titleElement = /** @type {HTMLHeadingElement} */ (document.querySelector("#assistant-title"));
const statusElement = /** @type {HTMLParagraphElement} */ (document.querySelector("#status"));
const liveStatusElement = /** @type {HTMLParagraphElement} */ (document.querySelector("#live-status"));
const modelNoteElement = /** @type {HTMLSpanElement} */ (document.querySelector("#model-note"));
const characterCountElement = /** @type {HTMLSpanElement} */ (document.querySelector("#character-count"));
const messagesElement = /** @type {HTMLElement} */ (document.querySelector("#messages"));
const form = /** @type {HTMLFormElement} */ (document.querySelector("#question-form"));
const questionElement = /** @type {HTMLTextAreaElement} */ (document.querySelector("#question"));
const submitButton = /** @type {HTMLButtonElement} */ (document.querySelector("#submit"));
const cancelButton = /** @type {HTMLButtonElement} */ (document.querySelector("#cancel"));
const newChatButton = /** @type {HTMLButtonElement} */ (document.querySelector("#new-chat"));
const maximizeButton = /** @type {HTMLButtonElement} */ (document.querySelector("#maximize"));
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
let maximized = false;

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

/** Save completed conversation turns for this browser tab. */
function storeTranscript() {
  try {
    sessionStorage.setItem(transcriptKey, JSON.stringify(transcript.slice(-20)));
  } catch {}
}

/** Restore valid completed conversation turns from this browser tab. */
function restoreTranscript() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(transcriptKey) ?? "[]");
    if (Array.isArray(saved)) transcript = saved.filter((item) =>
      item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string"
    ).slice(-20);
  } catch {}
}

/** Scroll the conversation to its newest content. */
function scrollToBottom() {
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

/**
 * Build a folded list of documentation sources.
 *
 * @param {SourceLink[]} sources
 */
function sourceList(sources) {
  const unique = sources.filter((source, index) => sources.findIndex((candidate) => candidate.url === source.url) === index);
  if (!unique.length) return null;
  const details = document.createElement("details");
  details.className = "sources";
  const summary = document.createElement("summary");
  summary.textContent = `${unique.length} documentation ${unique.length === 1 ? "source" : "sources"}`;
  const list = document.createElement("ul");
  for (const source of unique) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_top";
    link.rel = "noopener noreferrer";
    link.textContent = source.heading && source.heading !== source.title ? `${source.title}: ${source.heading}` : source.title;
    item.append(link);
    list.append(item);
  }
  details.append(summary, list);
  return details;
}

/**
 * Build a folded, scrollable copy of the closest exact documentation passage.
 *
 * @param {string | undefined} excerpt
 */
function excerptDetails(excerpt) {
  if (!excerpt) return null;
  const details = document.createElement("details");
  details.className = "documentation-excerpt";
  const summary = document.createElement("summary");
  summary.textContent = "Show relevant documentation";
  const content = document.createElement("div");
  renderMarkdown(content, excerpt);
  details.append(summary, content);
  return details;
}

/**
 * Render assistant Markdown with any exact excerpt and folded source links.
 *
 * @param {HTMLElement} article
 * @param {TranscriptMessage} message
 */
function renderAssistantMessage(article, message) {
  renderMarkdown(article, message.content, message.sources ?? []);
  const excerpt = excerptDetails(message.excerpt);
  if (excerpt) article.append(excerpt);
  const sources = sourceList(message.sources ?? []);
  if (sources) article.append(sources);
}

/**
 * Render one conversation turn.
 *
 * @param {TranscriptMessage} message
 * @param {boolean} [scroll]
 */
function appendMessage(message, scroll = true) {
  const article = document.createElement("article");
  article.className = `message ${message.role}`;
  if (message.role === "assistant") renderAssistantMessage(article, message);
  else article.textContent = message.content;
  messagesElement.append(article);
  if (scroll) scrollToBottom();
  return article;
}

/** Render the restored conversation or its one-line greeting. */
function renderTranscript() {
  messagesElement.replaceChildren();
  if (!transcript.length && config) appendMessage({ role: "assistant", content: config.greeting }, false);
  else for (const message of transcript) appendMessage(message, false);
  scrollToBottom();
}

/**
 * Render a temporary assistant activity message.
 *
 * @param {string} text
 */
function activityMessage(text) {
  const article = document.createElement("article");
  article.className = "message assistant activity";
  const label = document.createElement("p");
  label.textContent = text;
  const progress = document.createElement("progress");
  progress.max = 1;
  progress.removeAttribute("value");
  article.append(label, progress);
  messagesElement.append(article);
  scrollToBottom();
  return { article, label, progress };
}

/**
 * Replace temporary content with a compact retry message.
 *
 * @param {HTMLElement} article
 * @param {string} question
 * @param {string} message
 */
function showRetry(article, question, message) {
  article.className = "message assistant error";
  const paragraph = document.createElement("p");
  paragraph.textContent = message;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "retry";
  retry.textContent = "Try again";
  retry.addEventListener("click", () => {
    article.remove();
    void askQuestion(question);
  }, { once: true });
  article.replaceChildren(paragraph, retry);
  scrollToBottom();
}

/**
 * Update the composer controls and status while work is active.
 *
 * @param {boolean} working
 */
function setWorking(working) {
  questionElement.disabled = working || !config || !("gpu" in navigator);
  submitButton.disabled = working || !config || !("gpu" in navigator);
  cancelButton.hidden = !generation;
}

/**
 * Start WebLLM on the first question and report progress in the conversation.
 *
 * @param {{article: HTMLElement, label: HTMLParagraphElement, progress: HTMLProgressElement}} activity
 */
async function ensureEngine(activity) {
  if (engine) return engine;
  if (!config) throw new Error("Assistant configuration has not loaded.");
  statusElement.textContent = "Downloading model";
  liveStatusElement.textContent = "Downloading the assistant model.";
  modelNoteElement.textContent = `${config.model.label}, about ${config.model.downloadMB} MB. Cached after the first run.`;
  const module = await import("./engine-client.mjs");
  engine = await module.createAssistantEngine({
    modelId: config.model.id,
    assetBase,
    forceDedicatedWorker,
    onProgress: (report) => {
      activity.progress.value = Math.max(0, Math.min(1, report.progress));
      activity.label.textContent = report.text || "Downloading model…";
    }
  });
  modelNoteElement.textContent = "Runs privately in this browser.";
  return engine;
}

/** Find the newest prior user question without feeding model answers back to it. */
function previousUserQuestion() {
  return [...transcript].reverse().find((message) => message.role === "user")?.content ?? "";
}

/**
 * Turn retrieved chunks into the source metadata shown to visitors.
 *
 * @param {CorpusChunk[]} chunks
 */
function sourceLinks(chunks) {
  return chunks.map(({ title, heading, url }) => ({ title, heading, url }));
}

/**
 * Ask the local model one question.
 *
 * @param {string} [suppliedQuestion]
 */
async function askQuestion(suppliedQuestion) {
  if (!config || !corpus || generation) return;
  const question = (suppliedQuestion ?? questionElement.value).trim();
  if (!question) return;
  if (question.length > MAX_QUESTION_CHARACTERS) {
    questionElement.setCustomValidity(`Keep the question under ${MAX_QUESTION_CHARACTERS} characters.`);
    questionElement.reportValidity();
    return;
  }
  questionElement.setCustomValidity("");
  questionElement.value = "";
  characterCountElement.textContent = `0 / ${MAX_QUESTION_CHARACTERS}`;
  appendMessage({ role: "user", content: question });

  if (/^(?:hi|hello|hey)[!. ]*$/iu.test(question)) {
    const answer = /** @type {TranscriptMessage} */ ({ role: "assistant", content: config.greeting });
    appendMessage(answer);
    transcript.push({ role: "user", content: question }, answer);
    transcript = transcript.slice(-20);
    storeTranscript();
    return;
  }

  const retrieved = retrieveChunks(corpus.chunks, question, { ...config.retrieval, currentUrl: pageContext.url });
  if (!retrieved.length) {
    const answer = /** @type {TranscriptMessage} */ ({
      role: "assistant",
      content: "I could not find that in this site's documentation. Try a more specific term or identifier."
    });
    appendMessage(answer);
    transcript.push({ role: "user", content: question }, answer);
    transcript = transcript.slice(-20);
    storeTranscript();
    return;
  }

  const activity = activityMessage(engine ? "Preparing sources…" : "Starting the assistant…");
  generation = new AbortController();
  setWorking(true);
  try {
    const activeEngine = await ensureEngine(activity);
    if (generation.signal.aborted) throw new DOMException("The answer was stopped.", "AbortError");
    statusElement.textContent = "Preparing answer";
    activity.label.textContent = "Checking the question and sources…";
    activity.progress.removeAttribute("value");
    const module = await import("./engine-client.mjs");
    const fitted = await fitPrompt(
      question,
      retrieved,
      previousUserQuestion(),
      (messages) => module.countPromptTokens(activeEngine, messages)
    );
    if (!fitted) {
      activity.article.className = "message assistant error";
      activity.article.textContent = "That question is too long for this model. Shorten it and try again.";
      return;
    }
    if (!fitted.sources.length) {
      activity.article.className = "message assistant";
      activity.article.textContent = "The question fits, but there is not enough room for a documentation passage. Shorten the question and try again.";
      return;
    }

    const assistantMessage = /** @type {TranscriptMessage} */ ({
      role: "assistant",
      content: "",
      sources: sourceLinks(fitted.sources)
    });
    const article = activity.article;
    activity.label.textContent = "Writing a grounded answer…";
    statusElement.textContent = "Answering";
    liveStatusElement.textContent = "The assistant is answering.";
    const finishReason = await module.streamAnswer(activeEngine, fitted.messages, (text) => {
      assistantMessage.content += text;
    }, generation.signal);
    if (generation.signal.aborted) throw new DOMException("The answer was stopped.", "AbortError");
    const grounding = formatGroundedAnswer(assistantMessage.content, fitted.sources, finishReason);
    if (!grounding.ok) {
      console.warn("smgen-assistant: rejected ungrounded answer", grounding);
      const best = fitted.sources[0];
      const extracted = best ? formatExtractiveAnswer(best) : "";
      assistantMessage.content = extracted || (best
        ? `See **${best.heading || best.title}** for the closest matching documentation. [Source 1]`
        : "Try a more specific term from the documentation.");
      assistantMessage.sources = best ? sourceLinks([best]) : [];
      if (best) assistantMessage.excerpt = best.content;
    } else {
      assistantMessage.content = grounding.answer;
      assistantMessage.sources = sourceLinks(grounding.sources);
      if (grounding.filtered && fitted.sources[0]) assistantMessage.excerpt = fitted.sources[0].content;
    }
    article.className = "message assistant";
    renderAssistantMessage(article, assistantMessage);
    transcript.push({ role: "user", content: question }, assistantMessage);
    transcript = transcript.slice(-20);
    storeTranscript();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      activity.article.className = "message assistant";
      activity.article.textContent = "Answer stopped.";
    } else {
      console.error("smgen-assistant: question failed", error);
      const module = await import("./engine-client.mjs");
      if (module.isContextWindowError(error)) {
        activity.article.className = "message assistant error";
        activity.article.textContent = "That question and its sources are too long for this model. Shorten the question and try again.";
      } else {
        const failedEngine = engine;
        engine = null;
        forceDedicatedWorker = true;
        if (failedEngine) await module.releaseAssistantEngine(failedEngine);
        modelNoteElement.textContent = "The model will restart when you try again.";
        showRetry(activity.article, question, "The model stopped before it could answer.");
      }
    }
  } finally {
    generation = null;
    setWorking(false);
    statusElement.textContent = engine ? "Ready" : "Starts with your first question";
    liveStatusElement.textContent = engine ? "The assistant is ready." : "";
    questionElement.focus();
    scrollToBottom();
  }
}

/** Clear the visible and stored conversation while keeping a loaded model. */
async function newChat() {
  generation?.abort();
  transcript = [];
  storeTranscript();
  if (engine) await engine.resetChat();
  renderTranscript();
  liveStatusElement.textContent = "Started a new chat.";
  questionElement.focus();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void askQuestion();
});
questionElement.addEventListener("input", () => {
  questionElement.setCustomValidity("");
  characterCountElement.textContent = `${questionElement.value.length} / ${MAX_QUESTION_CHARACTERS}`;
});
questionElement.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
cancelButton.addEventListener("click", () => generation?.abort());
newChatButton.addEventListener("click", () => void newChat());
maximizeButton.addEventListener("click", () => window.parent.postMessage({ type: "smgen-assistant:toggle-maximize" }, location.origin));
closeButton.addEventListener("click", () => window.parent.postMessage({ type: "smgen-assistant:close" }, location.origin));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.parent.postMessage({ type: "smgen-assistant:close" }, location.origin);
});
window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.source !== window.parent || typeof event.data !== "object" || event.data === null) return;
  if (event.data.type === "smgen-assistant:context" && typeof event.data.url === "string" && typeof event.data.title === "string") {
    pageContext = { url: event.data.url, title: event.data.title };
  }
  if (event.data.type === "smgen-assistant:layout" && typeof event.data.maximized === "boolean") {
    maximized = event.data.maximized;
    maximizeButton.textContent = maximized ? "↙" : "↗";
    maximizeButton.setAttribute("aria-label", maximized ? "Restore assistant size" : "Expand assistant");
    maximizeButton.title = maximized ? "Restore assistant size" : "Expand assistant";
  }
});

/** Load generated data and initialize the first-question interface. */
async function start() {
  try {
    const [loadedConfig, loadedCorpus] = await Promise.all([
      fetchJson("config.json"),
      fetchJson("corpus.json")
    ]);
    config = loadedConfig;
    corpus = loadedCorpus;
    titleElement.textContent = loadedConfig.title;
    restoreTranscript();
    renderTranscript();
    if (!("gpu" in navigator)) {
      statusElement.textContent = "WebGPU unavailable";
      modelNoteElement.textContent = "This browser does not provide WebGPU.";
    } else {
      statusElement.textContent = "Starts with your first question";
      modelNoteElement.textContent = `${loadedConfig.model.label}, about ${loadedConfig.model.downloadMB} MB on first use.`;
      questionElement.disabled = false;
      submitButton.disabled = false;
    }
  } catch (error) {
    console.error("smgen-assistant: data failed to load", error);
    statusElement.textContent = "Assistant unavailable";
    modelNoteElement.textContent = "The assistant data could not load.";
    appendMessage({ role: "assistant", content: "The assistant data could not load. Reload the page to try again." });
  } finally {
    window.parent.postMessage({ type: "smgen-assistant:ready" }, location.origin);
    questionElement.disabled ? closeButton.focus() : questionElement.focus();
  }
}

void start();
