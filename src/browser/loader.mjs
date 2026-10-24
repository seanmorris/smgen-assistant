// @ts-check

(() => {
  if (document.querySelector("[data-smgen-assistant-launcher]")) return;
  const script = /** @type {HTMLScriptElement | null} */ (document.currentScript);
  if (!script?.src) return;
  const assetBase = new URL("./", script.src);
  const expectedOrigin = assetBase.origin;
  const openStorageKey = `smgen-assistant:open:${assetBase.pathname}`;
  const sizeStorageKey = `smgen-assistant:size:${assetBase.pathname}`;
  const minimumWidth = 320;
  const minimumHeight = 360;
  const defaultSize = { width: 400, height: 624 };

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
  style.textContent = `.smgen-assistant-launcher{position:fixed;right:1rem;bottom:1rem;z-index:2147483000;width:3.25rem;height:3.25rem;border:0;border-radius:50%;background:#182536;color:#fff;box-shadow:0 5px 22px #0005;font:700 1rem/1 system-ui;cursor:pointer}.smgen-assistant-launcher:focus-visible,.smgen-assistant-resize:focus-visible{outline:3px solid #64b5f6;outline-offset:3px}.smgen-assistant-shell{position:fixed;right:1rem;bottom:1rem;z-index:2147482999;min-width:20rem;min-height:22.5rem;max-width:calc(100vw - 2rem);max-height:calc(100dvh - 2rem);border-radius:.75rem;background:#fff;box-shadow:0 10px 40px #0006}.smgen-assistant-shell[hidden]{display:none}.smgen-assistant-frame{display:block;width:100%;height:100%;border:0;border-radius:inherit;background:#fff}.smgen-assistant-resize{position:absolute;left:-.45rem;top:-.45rem;z-index:1;width:1.4rem;height:1.4rem;border:1px solid #b9c4d0;border-radius:50%;background:#fff;color:#182536;box-shadow:0 2px 8px #0004;cursor:nwse-resize;font:700 .8rem/1 system-ui;padding:0;touch-action:none}.smgen-assistant-shell.is-maximized{inset:.5rem;width:auto!important;height:auto!important;max-width:none;max-height:none}.smgen-assistant-shell.is-maximized .smgen-assistant-resize{display:none}@media(max-width:34rem){.smgen-assistant-shell{inset:.5rem;width:calc(100vw - 1rem)!important;height:calc(100dvh - 1rem)!important;min-width:0;min-height:0;max-width:none;max-height:none}.smgen-assistant-resize{display:none}}@media(prefers-reduced-motion:no-preference){.smgen-assistant-launcher{transition:transform .15s ease}.smgen-assistant-launcher:hover{transform:scale(1.04)}}`;
  document.head.append(style);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "smgen-assistant-launcher";
  button.dataset.smgenAssistantLauncher = "";
  button.setAttribute("aria-label", "Open documentation assistant");
  button.setAttribute("aria-expanded", "false");
  button.textContent = "Ask";
  document.body.append(button);

  /** @type {HTMLDivElement | null} */
  let shell = null;
  /** @type {HTMLIFrameElement | null} */
  let frame = null;
  let size = restoreSize();
  let maximized = false;

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
    url: location.href,
    title: document.title
  }, expectedOrigin);

  /** Tell the frame whether its maximize button should restore or expand. */
  const sendLayout = () => frame?.contentWindow?.postMessage({
    type: "smgen-assistant:layout",
    maximized
  }, expectedOrigin);

  /** Hide the assistant while retaining its in-tab state. */
  const close = () => {
    if (!shell) return;
    shell.hidden = true;
    button.hidden = false;
    button.setAttribute("aria-expanded", "false");
    storeOpenState("0");
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
  const open = () => {
    if (!frame) {
      shell = document.createElement("div");
      shell.className = "smgen-assistant-shell";
      shell.setAttribute("role", "dialog");
      shell.setAttribute("aria-label", "Documentation assistant");
      frame = document.createElement("iframe");
      frame.className = "smgen-assistant-frame";
      frame.title = "Documentation assistant";
      frame.src = new URL("frame.html", assetBase).href;
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
        frame?.contentWindow?.focus();
      }, { once: true });
      shell.append(frame, resize);
      document.body.append(shell);
      applySize();
    }
    if (!shell) return;
    shell.hidden = false;
    button.hidden = true;
    button.setAttribute("aria-expanded", "true");
    storeOpenState("1");
    frame.contentWindow?.focus();
    sendContext();
    sendLayout();
  };

  button.addEventListener("click", open);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && shell && !shell.hidden) close();
  });
  window.addEventListener("resize", () => {
    if (!maximized) applySize();
  });
  window.addEventListener("message", (event) => {
    if (event.origin !== expectedOrigin || event.source !== frame?.contentWindow || typeof event.data !== "object" || event.data === null) return;
    if (event.data.type === "smgen-assistant:ready") {
      sendContext();
      sendLayout();
    }
    if (event.data.type === "smgen-assistant:close") close();
    if (event.data.type === "smgen-assistant:toggle-maximize") toggleMaximized();
  });
  if (restoreOpenState()) open();
})();
