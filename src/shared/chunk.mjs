// @ts-check

/**
 * @typedef {object} MarkdownChunk
 * @property {string} heading
 * @property {string} content
 */

/**
 * Split one section at blank lines outside fenced code blocks.
 * A single long code block remains intact.
 *
 * @param {string[]} lines
 * @param {number} maxCharacters
 * @returns {string[]}
 */
function splitSection(lines, maxCharacters) {
  /** @type {string[]} */
  const parts = [];
  /** @type {string[]} */
  let current = [];
  /** @type {"`" | "~" | null} */
  let fence = null;

  /** Store the current nonempty chunk and reset the line buffer. */
  const flush = () => {
    const content = current.join("\n").trim();
    if (content) parts.push(content);
    current = [];
  };

  for (const line of lines) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1]?.[0];
    if (marker === "`" || marker === "~") {
      fence = fence === marker ? null : fence ?? marker;
    }
    const prospectiveLength = current.join("\n").length + line.length + 1;
    if (!fence && !line.trim() && prospectiveLength >= maxCharacters && current.length) {
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
 * @returns {MarkdownChunk[]}
 */
export function chunkMarkdown(markdown, pageTitle, maxCharacters = 4000) {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  /** @type {MarkdownChunk[]} */
  const chunks = [];
  /** @type {string[]} */
  const headingStack = [];
  /** @type {string[]} */
  let sectionLines = [];
  /** @type {"`" | "~" | null} */
  let fence = null;

  /** Store the current section as one or more bounded chunks. */
  const flush = () => {
    const heading = headingStack.length ? headingStack.join(" > ") : pageTitle;
    for (const content of splitSection(sectionLines, maxCharacters)) {
      chunks.push({ heading, content });
    }
    sectionLines = [];
  };

  for (const line of lines) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1]?.[0];
    if (marker === "`" || marker === "~") {
      fence = fence === marker ? null : fence ?? marker;
      sectionLines.push(line);
      continue;
    }
    const heading = !fence ? line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u) : null;
    if (heading) {
      flush();
      const level = heading[1]?.length ?? 1;
      const text = heading[2]?.trim() ?? pageTitle;
      headingStack.length = level - 1;
      headingStack[level - 1] = text;
      continue;
    }
    sectionLines.push(line);
  }
  flush();
  return chunks;
}
