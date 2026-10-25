// @ts-check

/**
 * @typedef {object} MarkdownChunk
 * @property {string} heading
 * @property {string} fragment
 * @property {string} content
 * @property {string[]} [intents]
 * @property {string[]} [keywords]
 */

/**
 * @typedef {object} AnnotatedLine
 * @property {string} text
 * @property {string[]} intents
 * @property {string[]} keywords
 */

const INTENT_DIRECTIVE = /^\s*<!--\s*<\s*(\/?)\s*(what|why|where|when|how|who)\b([^>]*)>\s*-->\s*$/iu;
const ATTRIBUTE = /([\p{L}_][\p{L}\p{N}_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;

/**
 * Read retrieval keywords from an opening intent annotation.
 *
 * @param {string} source
 * @returns {string[]}
 */
function annotationKeywords(source) {
  const keywords = [];
  for (const match of source.matchAll(ATTRIBUTE)) {
    if (match[1]?.toLocaleLowerCase("en-US") !== "keywords") continue;
    keywords.push(...(match[2] ?? match[3] ?? "").split(/[,;|]/u).map((value) => value.trim()).filter(Boolean));
  }
  return [...new Set(keywords)];
}

/**
 * Remove common inline Markdown syntax before deriving a heading identifier.
 *
 * @param {string} value
 */
function headingText(value) {
  return value
    .replace(/\s+\{[^}]*\}\s*$/u, "")
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/gu, "$1")
    .replace(/<[^>]*>/gu, "")
    .replace(/[`*_~]/gu, "")
    .trim();
}

/**
 * Derive Pandoc's common automatic heading identifier shape.
 *
 * @param {string} value
 */
function automaticFragment(value) {
  const cleaned = headingText(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}_.\s-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-")
    .replace(/^[^\p{L}]+/u, "");
  return cleaned || "section";
}

/**
 * Read an explicit Markdown heading identifier.
 *
 * @param {string} value
 */
function explicitFragment(value) {
  return value.match(/\s+\{[^}]*#([^\s.}]+)[^}]*\}\s*$/u)?.[1] ?? "";
}

/**
 * Split one section at blank lines outside fenced code blocks.
 * A single long code block remains intact.
 *
 * @param {AnnotatedLine[]} lines
 * @param {number} maxCharacters
 * @returns {Array<{content: string, intents: string[], keywords: string[]}>}
 */
function splitSection(lines, maxCharacters) {
  /** @type {Array<{content: string, intents: string[], keywords: string[]}>} */
  const parts = [];
  /** @type {AnnotatedLine[]} */
  let current = [];
  /** @type {"`" | "~" | null} */
  let fence = null;

  /** Store the current nonempty chunk and reset the line buffer. */
  const flush = () => {
    const content = current.map(({ text }) => text).join("\n").trim();
    if (content) {
      parts.push({
        content,
        intents: [...new Set(current.flatMap(({ intents }) => intents))],
        keywords: [...new Set(current.flatMap(({ keywords }) => keywords))]
      });
    }
    current = [];
  };

  for (const line of lines) {
    const marker = line.text.match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1]?.[0];
    if (marker === "`" || marker === "~") {
      fence = fence === marker ? null : fence ?? marker;
    }
    const prospectiveLength = current.reduce((length, item) => length + item.text.length + 1, 0) + line.text.length;
    if (!fence && !line.text.trim() && prospectiveLength >= maxCharacters && current.length) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return parts;
}

/**
 * Split Markdown at headings while retaining the heading path for retrieval.
 *
 * @param {string} markdown
 * @param {string} pageTitle
 * @param {number} [maxCharacters]
 * @param {Array<string | undefined>} [renderedFragments]
 * @returns {MarkdownChunk[]}
 */
export function chunkMarkdown(markdown, pageTitle, maxCharacters = 4000, renderedFragments = []) {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  /** @type {MarkdownChunk[]} */
  const chunks = [];
  /** @type {string[]} */
  const headingStack = [];
  /** @type {AnnotatedLine[]} */
  let sectionLines = [];
  /** @type {Array<{intent: string, keywords: string[]}>} */
  const annotations = [];
  /** @type {"`" | "~" | null} */
  let fence = null;
  let fragment = "";
  let headingIndex = 0;
  /** @type {Map<string, number>} */
  const fragmentCounts = new Map();

  /** Store the current section as one or more bounded chunks. */
  const flush = () => {
    const heading = headingStack.length ? headingStack.join(" > ") : pageTitle;
    for (const part of splitSection(sectionLines, maxCharacters)) {
      chunks.push({
        heading,
        fragment,
        content: part.content,
        ...(part.intents.length ? { intents: part.intents } : {}),
        ...(part.keywords.length ? { keywords: part.keywords } : {})
      });
    }
    sectionLines = [];
  };

  /**
   * Store one source line with the annotations active at that position.
   *
   * @param {string} line
   */
  const appendLine = (line) => {
    sectionLines.push({
      text: line,
      intents: [...new Set(annotations.map(({ intent }) => intent))],
      keywords: [...new Set(annotations.flatMap(({ keywords }) => keywords))]
    });
  };

  for (const line of lines) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1]?.[0];
    if (marker === "`" || marker === "~") {
      fence = fence === marker ? null : fence ?? marker;
      appendLine(line);
      continue;
    }
    const directive = !fence ? line.match(INTENT_DIRECTIVE) : null;
    if (directive) {
      flush();
      const closing = Boolean(directive[1]);
      const intent = directive[2]?.toLocaleLowerCase("en-US") ?? "";
      if (closing) {
        const active = annotations.at(-1)?.intent;
        if (active !== intent) {
          throw new Error(`Intent annotation </${intent}> cannot close ${active ? `<${active}>` : "without an opening tag"}`);
        }
        annotations.pop();
      } else {
        annotations.push({ intent, keywords: annotationKeywords(directive[3] ?? "") });
      }
      continue;
    }
    const heading = !fence ? line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u) : null;
    if (heading) {
      flush();
      const level = heading[1]?.length ?? 1;
      const rawText = heading[2]?.trim() ?? pageTitle;
      const text = headingText(rawText) || pageTitle;
      const supplied = renderedFragments[headingIndex];
      const baseFragment = supplied || explicitFragment(rawText) || automaticFragment(text);
      const count = fragmentCounts.get(baseFragment) ?? 0;
      fragmentCounts.set(baseFragment, count + 1);
      fragment = supplied ? supplied : count ? `${baseFragment}-${count}` : baseFragment;
      headingIndex += 1;
      headingStack.length = level - 1;
      headingStack[level - 1] = text;
      continue;
    }
    appendLine(line);
  }
  flush();
  if (annotations.length) {
    throw new Error(`Intent annotation <${annotations.at(-1)?.intent}> is not closed`);
  }
  return chunks;
}
