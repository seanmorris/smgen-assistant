// @ts-check

import { adapterCompatibilityIssue } from "./model-selection.mjs";

/** @typedef {import('../shared/types.mjs').PublicAssistantConfig} PublicAssistantConfig */

const lotusIconMarkup = /** @type {typeof globalThis & {__SMGEN_ASSISTANT_LOTUS_ICON__: string}} */ (globalThis).__SMGEN_ASSISTANT_LOTUS_ICON__;

(() => {
  if (document.querySelector("[data-smgen-assistant-launcher]")) return;
  const script = /** @type {HTMLScriptElement | null} */ (document.currentScript);
  if (!script?.src) return;
  const scriptUrl = new URL(script.src);
  const assetBase = new URL("./", scriptUrl);
  const expectedOrigin = assetBase.origin;
  const openStorageKey = `smgen-assistant:open:${assetBase.pathname}`;
  const sizeStorageKey = `smgen-assistant:size:${assetBase.pathname}`;
  const messageChannelId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const minimumWidth = 320;
  const minimumHeight = 360;
  const defaultSize = { width: 400, height: 624 };
  const darkPreference = window.matchMedia?.("(prefers-color-scheme: dark)");
  /** @type {PublicAssistantConfig | null} */
  let loadedConfig = null;

  /** Check whether this browser can run at least one configured model. */
  const supportsConfiguredModel = async () => {
    if (!("gpu" in navigator)) return false;
    try {
      const [response, adapter] = await Promise.all([
        fetch(new URL("config.json", assetBase), { cache: "no-cache", credentials: "same-origin" }),
        navigator.gpu.requestAdapter({ powerPreference: "high-performance" })
      ]);
      if (!response.ok || !adapter) return false;
      const config = /** @type {PublicAssistantConfig} */ (await response.json());
      loadedConfig = config;
      const models = Array.isArray(config.models) && config.models.length ? config.models : [config.model];
      const deviceMemoryGB = /** @type {Navigator & {deviceMemory?: number}} */ (navigator).deviceMemory ?? null;
      return models.some((model) => model && adapterCompatibilityIssue(adapter, model, deviceMemoryGB) === null);
    } catch {
      return false;
    }
  };

  /** Unload and unregister the engine service worker used by older releases. */
  const retireLegacyServiceWorker = async () => {
    if (!("serviceWorker" in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration(assetBase.href);
      const worker = registration?.active ?? registration?.waiting ?? registration?.installing;
      if (!registration || !worker) return;
      const workerUrl = new URL(worker.scriptURL);
      const legacyUrl = new URL("service-worker.js", assetBase);
      if (workerUrl.origin !== legacyUrl.origin || workerUrl.pathname !== legacyUrl.pathname) return;
      worker.postMessage({ kind: "unload", uuid: crypto.randomUUID(), content: null });
      await registration.unregister();
    } catch (error) {
      console.warn("smgen-assistant: could not retire the previous service worker", error);
    }
  };
  const legacyServiceWorkerRetired = retireLegacyServiceWorker();

  /** Read the host site's explicit theme, with the browser preference as a fallback. */
  const readTheme = () => {
    const classes = document.documentElement?.classList;
    if (classes?.contains("dark")) return "dark";
    if (classes?.contains("light")) return "light";
    return darkPreference?.matches ? "dark" : "light";
  };

  /**
   * Store the open state when tab storage is available.
   *
   * @param {"0" | "1"} value
   */
  const storeOpenState = (value) => {
    try { sessionStorage.setItem(openStorageKey, value); } catch {}
  };

  /** Read the open state without making storage a runtime requirement. */
  const restoreOpenState = () => {
    try { return sessionStorage.getItem(openStorageKey) === "1"; } catch { return false; }
  };

  /**
   * Persist a visitor-selected panel size between visits.
   *
   * @param {{width: number, height: number}} size
   */
  const storeSize = (size) => {
    try { localStorage.setItem(sizeStorageKey, JSON.stringify(size)); } catch {}
  };

  /** Restore a finite saved panel size or use the compact default. */
  const restoreSize = () => {
    try {
      const size = JSON.parse(localStorage.getItem(sizeStorageKey) ?? "null");
      if (Number.isFinite(size?.width) && Number.isFinite(size?.height)) {
        return { width: Number(size.width), height: Number(size.height) };
      }
    } catch {}
    return { ...defaultSize };
  };

  const style = document.createElement("style");
  style.textContent = `
.smgen-assistant-launcher{--smgen-lotus-fill:#fff;position:fixed;right:1rem;bottom:1rem;z-index:2147483000;display:grid;place-items:center;width:3.25rem;height:3.25rem;padding:.42rem;border:1px solid #111923;border-radius:50%;background:#111923;color:#fff;box-shadow:0 5px 22px #0005;cursor:pointer}
.smgen-assistant-launcher[data-theme=dark]{--smgen-lotus-fill:#111923;border-color:#fff;background:#fff;color:#111923}
.smgen-assistant-launcher[hidden]{display:none}
.smgen-assistant-launcher-icon{display:block;width:2.35rem;height:auto;overflow:visible;pointer-events:none}
.smgen-lotus-petal{transform:rotate(0deg);transform-box:view-box;transform-origin:72px 104px}
.smgen-lotus-petal-outer-left{--smgen-lotus-angle:-60deg}
.smgen-lotus-petal-outer-right{--smgen-lotus-angle:60deg}
.smgen-lotus-petal-inner-left{--smgen-lotus-angle:-30deg}
.smgen-lotus-petal-inner-right{--smgen-lotus-angle:30deg}
.smgen-assistant-launcher.is-open .smgen-lotus-petal{transform:rotate(var(--smgen-lotus-angle))}
.smgen-assistant-launcher:focus-visible,.smgen-assistant-resize:focus-visible{outline:3px solid #64b5f6;outline-offset:3px}
.smgen-assistant-shell{--smgen-assistant-surface:#fff;--smgen-assistant-text:#182536;--smgen-assistant-border:#b9c4d0;position:fixed;right:1rem;bottom:5rem;z-index:2147482999;min-width:20rem;min-height:22.5rem;max-width:calc(100vw - 2rem);max-height:calc(100dvh - 6rem);border-radius:.75rem;background:var(--smgen-assistant-surface);box-shadow:0 10px 40px #0006}
.smgen-assistant-shell[data-theme=dark]{--smgen-assistant-surface:#111923;--smgen-assistant-text:#edf4fa;--smgen-assistant-border:#344354}
.smgen-assistant-shell[hidden]{display:none}
.smgen-assistant-frame{display:block;width:100%;height:100%;border:0;border-radius:inherit;background:var(--smgen-assistant-surface)}
.smgen-assistant-resize{position:absolute;left:-.45rem;top:-.45rem;z-index:1;width:1.4rem;height:1.4rem;border:1px solid var(--smgen-assistant-border);border-radius:50%;background:var(--smgen-assistant-surface);color:var(--smgen-assistant-text);box-shadow:0 2px 8px #0004;cursor:nwse-resize;font:700 .8rem/1 system-ui;padding:0;touch-action:none}
.smgen-assistant-shell.is-maximized{inset:.5rem .5rem 4.75rem;width:auto!important;height:auto!important;max-width:none;max-height:none}
.smgen-assistant-shell.is-maximized .smgen-assistant-resize{display:none}
@media(max-width:34rem){.smgen-assistant-shell{inset:.5rem .5rem 4.75rem;width:auto!important;height:auto!important;min-width:0;min-height:0;max-width:none;max-height:none}.smgen-assistant-resize{display:none}}
@media(prefers-reduced-motion:no-preference){
  .smgen-assistant-launcher{transition:transform .15s ease}
  .smgen-assistant-launcher:hover{transform:scale(1.04)}
  .smgen-lotus-petal{transition:transform .42s cubic-bezier(.2,.8,.2,1)}
  .smgen-assistant-launcher.is-thinking .smgen-lotus-petal{animation:smgen-lotus-thinking 1.35s ease-in-out infinite}
  @keyframes smgen-lotus-thinking{0%,100%{transform:rotate(0deg)}50%{transform:rotate(var(--smgen-lotus-angle))}}
}
@media(prefers-reduced-motion:reduce){.smgen-assistant-launcher.is-thinking .smgen-lotus-petal{transform:rotate(var(--smgen-lotus-angle))}}
`;
  document.head.append(style);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "smgen-assistant-launcher";
  button.dataset.smgenAssistantLauncher = "";
  button.dataset.theme = readTheme();
  button.setAttribute("aria-label", "Open documentation assistant");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-busy", "false");
  button.title = "Open documentation assistant";
  button.innerHTML = lotusIconMarkup;
  button.hidden = true;
  document.body.append(button);

  /** @type {HTMLDivElement | null} */
  let shell = null;
  /** @type {HTMLIFrameElement | null} */
  let frame = null;
  let size = restoreSize();
  let maximized = false;
  let theme = readTheme();

  /**
   * Restrict a requested panel size to the visible viewport.
   *
   * @param {{width: number, height: number}} requested
   */
  const clampSize = (requested) => ({
    width: Math.max(minimumWidth, Math.min(requested.width, Math.max(minimumWidth, window.innerWidth - 32))),
    height: Math.max(minimumHeight, Math.min(requested.height, Math.max(minimumHeight, window.innerHeight - 32)))
  });

  /** Apply the saved custom size outside the mobile and maximized layouts. */
  const applySize = () => {
    if (!shell) return;
    size = clampSize(size);
    shell.style.width = `${size.width}px`;
    shell.style.height = `${size.height}px`;
  };

  /** Send current host page details to the isolated frame. */
  const sendContext = () => frame?.contentWindow?.postMessage({
    type: "smgen-assistant:context",
    channelId: messageChannelId,
    url: location.href,
    title: document.title
  }, expectedOrigin);

  /** Tell the frame whether its maximize button should restore or expand. */
  const sendLayout = () => frame?.contentWindow?.postMessage({
    type: "smgen-assistant:layout",
    channelId: messageChannelId,
    maximized
  }, expectedOrigin);

  /** Apply the host theme to the panel chrome and its isolated frame. */
  const syncTheme = () => {
    theme = readTheme();
    button.dataset.theme = theme;
    if (shell) shell.dataset.theme = theme;
    frame?.contentWindow?.postMessage({
      type: "smgen-assistant:theme",
      channelId: messageChannelId,
      theme
    }, expectedOrigin);
  };

  /**
   * Reflect the panel state in the launcher icon and accessible name.
   *
   * @param {boolean} openState
   */
  const setLauncherOpenState = (openState) => {
    button.classList.toggle("is-open", openState);
    button.setAttribute("aria-expanded", String(openState));
    const label = openState ? "Close documentation assistant" : "Open documentation assistant";
    button.setAttribute("aria-label", label);
    button.title = label;
    storeOpenState(openState ? "1" : "0");
  };

  /** Hide the assistant while retaining its in-tab state. */
  const close = () => {
    if (!shell) return;
    shell.hidden = true;
    setLauncherOpenState(false);
    button.focus();
  };

  /** Toggle the viewport-sized panel while retaining the visitor's custom size. */
  const toggleMaximized = () => {
    if (!shell) return;
    maximized = !maximized;
    shell.classList.toggle("is-maximized", maximized);
    if (!maximized) applySize();
    sendLayout();
  };

  /**
   * Resize the panel with pointer movement from its upper-left handle.
   *
   * @param {PointerEvent} event
   */
  const startResize = (event) => {
    if (!shell || maximized) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY, width: shell.offsetWidth, height: shell.offsetHeight };
    const handle = /** @type {HTMLElement} */ (event.currentTarget);
    handle.setPointerCapture(event.pointerId);
    /**
     * Apply pointer movement to the bottom-right anchored panel.
     *
     * @param {PointerEvent} moveEvent
     */
    const move = (moveEvent) => {
      size = clampSize({
        width: start.width - (moveEvent.clientX - start.x),
        height: start.height - (moveEvent.clientY - start.y)
      });
      applySize();
    };
    /** Save the final size and remove temporary pointer listeners. */
    const finish = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      storeSize(size);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  };

  /**
   * Resize the panel from the keyboard in predictable increments.
   *
   * @param {KeyboardEvent} event
   */
  const resizeWithKeyboard = (event) => {
    if (!shell || maximized || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 64 : 24;
    if (event.key === "ArrowLeft") size.width += step;
    if (event.key === "ArrowRight") size.width -= step;
    if (event.key === "ArrowUp") size.height += step;
    if (event.key === "ArrowDown") size.height -= step;
    size = clampSize(size);
    applySize();
    storeSize(size);
  };

  /** Create the frame on first use and reveal it on later uses. */
  const open = async () => {
    await legacyServiceWorkerRetired;
    if (!frame) {
      shell = document.createElement("div");
      shell.className = "smgen-assistant-shell";
      shell.dataset.theme = theme;
      shell.setAttribute("role", "dialog");
      shell.setAttribute("aria-label", "Documentation assistant");
      frame = document.createElement("iframe");
      frame.className = "smgen-assistant-frame";
      frame.title = "Documentation assistant";
      const frameUrl = new URL("frame.html", assetBase);
      const siteId = scriptUrl.searchParams.get("site") || loadedConfig?.siteId;
      if (siteId) frameUrl.searchParams.set("site", siteId);
      if (loadedConfig?.assetVersion) frameUrl.searchParams.set("v", loadedConfig.assetVersion);
      frame.src = frameUrl.href;
      frame.style.visibility = "hidden";
      frame.setAttribute("allow", "webgpu");
      const resize = document.createElement("button");
      resize.type = "button";
      resize.className = "smgen-assistant-resize";
      resize.setAttribute("aria-label", "Resize assistant. Use arrow keys, or Shift and arrow keys for larger steps.");
      resize.textContent = "↖";
      resize.addEventListener("pointerdown", startResize);
      resize.addEventListener("keydown", resizeWithKeyboard);
      frame.addEventListener("load", () => {
        sendContext();
        sendLayout();
        syncTheme();
      }, { once: true });
      shell.append(frame, resize);
      document.body.append(shell);
      applySize();
    }
    if (!shell) return;
    shell.hidden = false;
    setLauncherOpenState(true);
    frame.contentWindow?.focus();
    sendContext();
    sendLayout();
    syncTheme();
  };

  button.addEventListener("click", () => {
    if (shell && !shell.hidden) close();
    else void open();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && shell && !shell.hidden) close();
  });
  window.addEventListener("resize", () => {
    if (!maximized) applySize();
  });
  window.addEventListener("message", (event) => {
    if (event.origin !== expectedOrigin || typeof event.data !== "object" || event.data === null) return;
    const sourceMatches = event.source === frame?.contentWindow;
    const channelMatches = event.data.channelId === messageChannelId;
    if (!sourceMatches && !channelMatches) return;
    if (event.data.type === "smgen-assistant:ready") {
      sendContext();
      sendLayout();
      syncTheme();
    }
    if (event.data.type === "smgen-assistant:theme-applied" && frame) {
      frame.style.visibility = "visible";
      frame.contentWindow?.focus();
    }
    if (event.data.type === "smgen-assistant:activity" && typeof event.data.active === "boolean") {
      button.classList.toggle("is-thinking", event.data.active);
      button.setAttribute("aria-busy", String(event.data.active));
    }
    if (event.data.type === "smgen-assistant:close") close();
    if (event.data.type === "smgen-assistant:toggle-maximize") toggleMaximized();
  });
  if (typeof MutationObserver !== "undefined" && document.documentElement) {
    new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  }
  darkPreference?.addEventListener?.("change", syncTheme);
  void (async () => {
    if (!await supportsConfiguredModel()) return;
    button.hidden = false;
    syncTheme();
    if (restoreOpenState()) await open();
  })();
})();
