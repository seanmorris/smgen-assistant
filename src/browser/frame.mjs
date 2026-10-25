// @ts-check

import { retrieveChunks } from "../shared/retrieval.mjs";
import { formatExtractiveAnswerSet, formatGeneratedAnswer } from "../shared/grounding.mjs";
import { fitPrompt, MAX_QUESTION_CHARACTERS, questionUsesPreviousContext } from "../shared/prompt.mjs";
import { renderMarkdown } from "./render.mjs";

/** @typedef {import('../shared/types.mjs').Corpus} Corpus */
/** @typedef {import('../shared/types.mjs').CorpusChunk} CorpusChunk */
/** @typedef {import('../shared/types.mjs').AssistantModel} AssistantModel */
/** @typedef {import('../shared/types.mjs').PublicAssistantConfig} PublicAssistantConfig */
/** @typedef {import('@mlc-ai/web-llm').MLCEngineInterface} MLCEngineInterface */
/** @typedef {Window & {__smgenEvaluationDeleteModel?: (modelId: string) => Promise<{deletedRecords: number, remainingRecords: number}>}} EvaluationWindow */

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
const evaluationMode = new URL(location.href).searchParams.get("evaluation") === "1";
const transcriptKey = `smgen-assistant:transcript:v3:${assetBase.pathname}`;
const modelKey = `smgen-assistant:model:${assetBase.pathname}`;
const titleElement = /** @type {HTMLHeadingElement} */ (document.querySelector("#assistant-title"));
const statusElement = /** @type {HTMLParagraphElement} */ (document.querySelector("#status"));
const liveStatusElement = /** @type {HTMLParagraphElement} */ (document.querySelector("#live-status"));
const modelNoteElement = /** @type {HTMLSpanElement} */ (document.querySelector("#model-note"));
const characterCountElement = /** @type {HTMLSpanElement} */ (document.querySelector("#character-count"));
const messagesElement = /** @type {HTMLElement} */ (document.querySelector("#messages"));
const form = /** @type {HTMLFormElement} */ (document.querySelector("#question-form"));
const modelChoiceElement = /** @type {HTMLDivElement} */ (document.querySelector("#model-choice"));
const modelSelectElement = /** @type {HTMLSelectElement} */ (document.querySelector("#model-select"));
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
/** @type {AssistantModel[]} */
let models = [];
/** @type {AssistantModel | null} */
let selectedModel = null;
/** @type {MLCEngineInterface | null} */
let engine = null;
/** @type {AbortController | null} */
let generation = null;
/** @type {{url: string, title: string}} */
let pageContext = { url: "", title: "" };
/** @type {TranscriptMessage[]} */
let transcript = [];
let maximized = false;

if (evaluationMode) {
  /** @type {EvaluationWindow} */ (window).__smgenEvaluationDeleteModel = deleteEvaluationModel;
}

/**
 * Send structured diagnostics only from an explicitly opened evaluation frame.
 *
 * @param {Record<string, unknown>} result
 */
function reportEvaluation(result) {
  if (!evaluationMode) return;
  window.parent.postMessage({ type: "smgen-assistant:evaluation-result", version: 1, ...result }, location.origin);
}

/**
 * Delete a tested model from disk after its isolated evaluation worker closes.
 *
 * @param {string} modelId
 * @returns {Promise<{deletedRecords: number, remainingRecords: number}>}
 */
async function deleteEvaluationModel(modelId) {
  if (!evaluationMode) throw new Error("Model deletion is available only in evaluation mode.");
  if (engine || generation) throw new Error("Close the model worker before deleting its cached files.");
  const module = await import("./engine-client.mjs");
  return module.deleteAssistantModelFromDisk(modelId);
}

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
  modelSelectElement.disabled = working || !config || !("gpu" in navigator);
  cancelButton.hidden = !generation;
}

/**
 * Describe the selected model without claiming estimates the site did not set.
 *
 * @param {AssistantModel} model
 * @param {boolean} [ready]
 */
function modelNote(model, ready = false) {
  if (ready) return `${model.label} runs privately in this browser.`;
  const estimates = [];
  if (model.downloadMB) estimates.push(`${model.downloadMB.toLocaleString()} MB download`);
  if (model.memoryMB) estimates.push(`${model.memoryMB.toLocaleString()} MB GPU memory`);
  return estimates.length
    ? `${model.label}, about ${estimates.join(" and ")}.`
    : `${model.label} downloads on first use.`;
}

/** Populate the model picker and restore a valid earlier selection. */
function configureModelPicker() {
  if (!config) return;
  models = Array.isArray(config.models) && config.models.length ? config.models : [config.model];
  let stored = "";
  try {
    stored = localStorage.getItem(modelKey) ?? "";
  } catch {}
  selectedModel = models.find(({ id }) => id === stored) ?? models[0] ?? null;
  modelSelectElement.replaceChildren();
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.downloadMB ? `${model.label} (${model.downloadMB.toLocaleString()} MB)` : model.label;
    modelSelectElement.append(option);
  }
  modelSelectElement.value = selectedModel?.id ?? "";
  modelChoiceElement.hidden = models.length < 2;
  if (selectedModel) modelNoteElement.textContent = modelNote(selectedModel);
}

/**
 * Start WebLLM on the first question and report progress in the conversation.
 *
 * @param {{article: HTMLElement, label: HTMLParagraphElement, progress: HTMLProgressElement}} activity
 */
async function ensureEngine(activity) {
  if (engine) return engine;
  if (!config || !selectedModel) throw new Error("Assistant configuration has not loaded.");
  statusElement.textContent = "Downloading model";
  liveStatusElement.textContent = "Downloading the assistant model.";
  modelNoteElement.textContent = `${modelNote(selectedModel)} Cached after the first run.`;
  const module = await import("./engine-client.mjs");
  engine = await module.createAssistantEngine({
    modelId: selectedModel.id,
    assetBase,
    onProgress: (report) => {
      activity.progress.value = Math.max(0, Math.min(1, report.progress));
      activity.label.textContent = report.text || "Downloading model…";
    }
  });
  modelNoteElement.textContent = modelNote(selectedModel, true);
  return engine;
}

/** Release the active engine and defer loading the newly selected model. */
async function changeModel() {
  if (!config || generation) return;
  const nextModel = models.find(({ id }) => id === modelSelectElement.value);
  if (!nextModel || nextModel.id === selectedModel?.id) return;
  setWorking(true);
  const previousEngine = engine;
  engine = null;
  try {
    if (previousEngine) {
      const module = await import("./engine-client.mjs");
      await module.releaseAssistantEngine(previousEngine);
    }
  } catch (error) {
    console.warn("smgen-assistant: previous model did not release cleanly", error);
  } finally {
    selectedModel = nextModel;
    try {
      localStorage.setItem(modelKey, nextModel.id);
    } catch {}
    modelNoteElement.textContent = modelNote(nextModel);
    statusElement.textContent = "Starts with your first question";
    liveStatusElement.textContent = `${nextModel.label} selected.`;
    setWorking(false);
    questionElement.focus();
  }
}

/**
 * Find the newest user question when the current wording refers back to it.
 *
 * @param {string} question
 */
function previousUserQuestion(question) {
  if (!questionUsesPreviousContext(question)) return "";
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
 * Finish an evaluation question immediately when generation cannot complete.
 *
 * @param {string} question
 * @param {number} startedAt
 * @param {CorpusChunk[]} retrieved
 * @param {CorpusChunk[]} fitted
 * @param {unknown} error
 */
function reportEvaluationFailure(question, startedAt, retrieved, fitted, error) {
  const failure = error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
  reportEvaluation({
    modelId: selectedModel?.id ?? "",
    question,
    retrievedSources: sourceLinks(retrieved),
    fittedSources: sourceLinks(fitted),
    promptTokens: null,
    rawAnswer: "",
    finishReason: null,
    validation: { ok: false, reason: "generation-error" },
    fallback: true,
    displayedAnswer: "",
    displayedSources: [],
    usage: null,
    error: failure,
    timing: {
      engineMs: null,
      generationMs: null,
      totalMs: Math.round(performance.now() - startedAt),
      reusedEngine: Boolean(engine)
    }
  });
}

/**
 * Ask the local model one question.
 *
 * @param {string} [suppliedQuestion]
 */
async function askQuestion(suppliedQuestion) {
  if (!config || !corpus || generation) return;
  const question = (suppliedQuestion ?? questionElement.value).trim();
  const startedAt = performance.now();
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
  const reusedEngine = Boolean(engine);
  generation = new AbortController();
  setWorking(true);
  try {
    const engineStartedAt = performance.now();
    const activeEngine = await ensureEngine(activity);
    const engineReadyAt = performance.now();
    if (generation.signal.aborted) throw new DOMException("The answer was stopped.", "AbortError");
    statusElement.textContent = "Preparing answer";
    activity.label.textContent = "Checking the question and sources…";
    activity.progress.removeAttribute("value");
    const module = await import("./engine-client.mjs");
    const fitted = await fitPrompt(
      question,
      retrieved,
      previousUserQuestion(question),
      (messages) => module.countPromptTokens(activeEngine, messages)
    );
    if (!fitted) {
      activity.article.className = "message assistant error";
      activity.article.textContent = "That question is too long for this model. Shorten it and try again.";
      reportEvaluationFailure(question, startedAt, retrieved, [], new Error("The prompt did not fit the model context."));
      return;
    }
    if (!fitted.sources.length) {
      activity.article.className = "message assistant";
      activity.article.textContent = "The question fits, but there is not enough room for a documentation passage. Shorten the question and try again.";
      reportEvaluationFailure(question, startedAt, retrieved, [], new Error("No documentation passage fit the model context."));
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
    /** @type {{completion_tokens: number, prompt_tokens: number, total_tokens: number, extra: Record<string, unknown>} | null} */
    let usage = null;
    const generationStartedAt = performance.now();
    const finishReason = await module.streamAnswer(activeEngine, fitted.messages, (text) => {
      assistantMessage.content += text;
    }, generation.signal, (value) => { usage = value; });
    const generationFinishedAt = performance.now();
    if (generation.signal.aborted) throw new DOMException("The answer was stopped.", "AbortError");
    const rawAnswer = assistantMessage.content;
    const grounding = formatGeneratedAnswer(assistantMessage.content, fitted.sources, finishReason);
    if (!grounding.ok) {
      console.warn("smgen-assistant: rejected ungrounded answer", grounding);
      const extracted = formatExtractiveAnswerSet(fitted.sources);
      const best = extracted.sources[0];
      assistantMessage.content = extracted.answer || (best
        ? `See **${best.heading || best.title}** for the closest matching documentation. [Source 1]`
        : "Try a more specific term from the documentation.");
      assistantMessage.sources = sourceLinks(extracted.sources);
      if (best) assistantMessage.excerpt = extracted.sources.map((source) => source.content).join("\n\n");
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
    reportEvaluation({
      modelId: selectedModel?.id ?? "",
      question,
      retrievedSources: sourceLinks(retrieved),
      fittedSources: sourceLinks(fitted.sources),
      promptTokens: fitted.promptTokens,
      rawAnswer,
      finishReason,
      validation: grounding.ok ? { ok: true, filtered: grounding.filtered } : grounding,
      fallback: !grounding.ok,
      displayedAnswer: assistantMessage.content,
      displayedSources: assistantMessage.sources ?? [],
      usage,
      timing: {
        engineMs: Math.round(engineReadyAt - engineStartedAt),
        generationMs: Math.round(generationFinishedAt - generationStartedAt),
        totalMs: Math.round(performance.now() - startedAt),
        reusedEngine
      }
    });
  } catch (error) {
    reportEvaluationFailure(question, startedAt, retrieved, [], error);
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
        if (failedEngine) await module.releaseAssistantEngine(failedEngine);
        modelNoteElement.textContent = selectedModel
          ? `${selectedModel.label} will restart when you try again.`
          : "The model will restart when you try again.";
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
modelSelectElement.addEventListener("change", () => void changeModel());
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
  if (event.data.type === "smgen-assistant:theme" && (event.data.theme === "light" || event.data.theme === "dark")) {
    document.documentElement.dataset.theme = event.data.theme;
    window.parent.postMessage({ type: "smgen-assistant:theme-applied" }, location.origin);
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
    configureModelPicker();
    restoreTranscript();
    renderTranscript();
    if (!("gpu" in navigator)) {
      statusElement.textContent = "WebGPU unavailable";
      modelNoteElement.textContent = "This browser does not provide WebGPU.";
    } else {
      statusElement.textContent = "Starts with your first question";
      if (selectedModel) modelNoteElement.textContent = modelNote(selectedModel);
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
