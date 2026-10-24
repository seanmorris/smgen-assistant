// @ts-check

/**
 * Accept navigational links and reject schemes that can execute content.
 *
 * @param {string} value
 */
export function safeLink(value) {
  const trimmed = value.trim();
  if (/^(?:https?:|mailto:)/iu.test(trimmed)) return trimmed;
  if (/^(?:\/|\.\/|\.\.\/|#)/u.test(trimmed)) return trimmed;
  return null;
}

/**
 * Append the supported inline Markdown tokens as DOM nodes.
 *
 * @param {HTMLElement} parent
 * @param {string} text
 * @param {Document} doc
 */
function appendInline(parent, text, doc) {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/gu;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    parent.append(doc.createTextNode(text.slice(cursor, index)));
    const token = match[0];
    if (token.startsWith("`")) {
      const code = doc.createElement("code");
      code.textContent = token.slice(1, -1);
      parent.append(code);
    } else if (token.startsWith("**")) {
      const strong = doc.createElement("strong");
      strong.textContent = token.slice(2, -2);
      parent.append(strong);
    } else if (token.startsWith("*")) {
      const emphasis = doc.createElement("em");
      emphasis.textContent = token.slice(1, -1);
      parent.append(emphasis);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/u);
      const href = safeLink(link?.[2] ?? "");
      if (href) {
        const anchor = doc.createElement("a");
        anchor.textContent = link?.[1] ?? href;
        anchor.href = href;
        anchor.target = "_top";
        anchor.rel = "noopener noreferrer";
        parent.append(anchor);
      } else {
        parent.append(doc.createTextNode(link?.[1] ?? token));
      }
    }
    cursor = index + token.length;
  }
  parent.append(doc.createTextNode(text.slice(cursor)));
}

/**
 * Render a constrained Markdown subset without parsing HTML.
 *
 * @param {HTMLElement} container
 * @param {string} markdown
 * @param {Document} [doc]
 */
export function renderMarkdown(container, markdown, doc = document) {
  container.replaceChildren();
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})([^\s]*)\s*$/u);
    if (fence) {
      const marker = fence[1]?.[0] ?? "`";
      const codeLines = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^\\s{0,3}\\${marker}{3,}`).test(lines[index] ?? "")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      const pre = doc.createElement("pre");
      const code = doc.createElement("code");
      code.textContent = codeLines.join("\n");
      if (fence[2]) code.dataset.language = fence[2];
      pre.append(code);
      container.append(pre);
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (heading) {
      const element = doc.createElement(`h${Math.min((heading[1]?.length ?? 1) + 1, 6)}`);
      appendInline(element, heading[2] ?? "", doc);
      container.append(element);
      index += 1;
      continue;
    }
    const list = line.match(/^\s*(?:([-*+])|(\d+\.))\s+(.+)$/u);
    if (list) {
      const ordered = Boolean(list[2]);
      const element = doc.createElement(ordered ? "ol" : "ul");
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(/^\s*(?:([-*+])|(\d+\.))\s+(.+)$/u);
        if (!item || Boolean(item[2]) !== ordered) break;
        const child = doc.createElement("li");
        appendInline(child, item[3] ?? "", doc);
        element.append(child);
        index += 1;
      }
      container.append(element);
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/u);
    if (quote) {
      const element = doc.createElement("blockquote");
      const quoteLines = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(/^\s*>\s?(.*)$/u);
        if (!item) break;
        quoteLines.push(item[1] ?? "");
        index += 1;
      }
      appendInline(element, quoteLines.join(" "), doc);
      container.append(element);
      continue;
    }
    const paragraphLines = [];
    while (index < lines.length && (lines[index] ?? "").trim()) {
      if (paragraphLines.length && /^(?:\s{0,3}#{1,6}\s|\s*(?:[-*+] |\d+\. )|\s*>|\s{0,3}(?:`{3,}|~{3,}))/u.test(lines[index] ?? "")) break;
      paragraphLines.push((lines[index] ?? "").trim());
      index += 1;
    }
    const paragraph = doc.createElement("p");
    appendInline(paragraph, paragraphLines.join(" "), doc);
    container.append(paragraph);
  }
}
