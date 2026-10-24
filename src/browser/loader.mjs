// @ts-check

(() => {
  if (document.querySelector("[data-smgen-assistant-launcher]")) return;
  const script = /** @type {HTMLScriptElement | null} */ (document.currentScript);
  if (!script?.src) return;
  const assetBase = new URL("./", script.src);
  const expectedOrigin = assetBase.origin;
  const storageKey = `smgen-assistant:open:${assetBase.pathname}`;

  /**
   * Store the open state when tab storage is available.
   *
   * @param {"0" | "1"} value
   */
  const storeOpenState = (value) => {
    try { sessionStorage.setItem(storageKey, value); } catch {}
  };

  /** Read the open state without making storage a runtime requirement. */
  const restoreOpenState = () => {
    try { return sessionStorage.getItem(storageKey) === "1"; } catch { return false; }
  };

  const style = document.createElement("style");
  style.textContent = `.smgen-assistant-launcher{position:fixed;right:1rem;bottom:1rem;z-index:2147483000;width:3.25rem;height:3.25rem;border:0;border-radius:50%;background:#182536;color:#fff;box-shadow:0 5px 22px #0005;font:700 1rem/1 system-ui;cursor:pointer}.smgen-assistant-launcher:focus-visible{outline:3px solid #64b5f6;outline-offset:3px}.smgen-assistant-frame{position:fixed;right:1rem;bottom:5rem;z-index:2147482999;width:min(25rem,calc(100vw - 2rem));height:min(39rem,calc(100vh - 7rem));border:0;border-radius:.75rem;background:#fff;box-shadow:0 10px 40px #0006}@media(max-width:34rem){.smgen-assistant-frame{inset:.5rem .5rem 5rem;width:auto;height:auto}}@media(prefers-reduced-motion:no-preference){.smgen-assistant-launcher{transition:transform .15s ease}.smgen-assistant-launcher:hover{transform:scale(1.04)}}`;
  document.head.append(style);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "smgen-assistant-launcher";
  button.dataset.smgenAssistantLauncher = "";
  button.setAttribute("aria-label", "Open documentation assistant");
  button.setAttribute("aria-expanded", "false");
  button.textContent = "Ask";
  document.body.append(button);

  /** @type {HTMLIFrameElement | null} */
  let frame = null;
  /** Send the current host page details to the isolated frame. */
  const sendContext = () => frame?.contentWindow?.postMessage({
    type: "smgen-assistant:context",
    url: location.href,
    title: document.title
  }, expectedOrigin);

  /** Hide the assistant while retaining its in-tab state. */
  const close = () => {
    if (!frame) return;
    frame.hidden = true;
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "Open documentation assistant");
    storeOpenState("0");
    button.focus();
  };

  /** Create the frame on first use and reveal it on later uses. */
  const open = () => {
    if (!frame) {
      frame = document.createElement("iframe");
      frame.className = "smgen-assistant-frame";
      frame.title = "Documentation assistant";
      frame.src = new URL("frame.html", assetBase).href;
      frame.setAttribute("allow", "webgpu");
      frame.setAttribute("role", "dialog");
      frame.setAttribute("aria-modal", "true");
      frame.addEventListener("load", () => frame?.contentWindow?.focus(), { once: true });
      document.body.append(frame);
    }
    frame.hidden = false;
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-label", "Close documentation assistant");
    storeOpenState("1");
    frame.contentWindow?.focus();
    sendContext();
  };

  button.addEventListener("click", () => frame && !frame.hidden ? close() : open());
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && frame && !frame.hidden) close();
  });
  window.addEventListener("message", (event) => {
    if (event.origin !== expectedOrigin || event.source !== frame?.contentWindow || typeof event.data !== "object" || event.data === null) return;
    if (event.data.type === "smgen-assistant:ready") sendContext();
    if (event.data.type === "smgen-assistant:close") close();
  });
  if (restoreOpenState()) open();
})();
