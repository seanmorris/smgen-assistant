// @ts-check

/**
 * Select the newest contiguous messages within count and character budgets.
 *
 * @template {{content: string}} T
 * @param {T[]} messages
 * @param {number} maxMessages
 * @param {number} maxCharacters
 * @returns {T[]}
 */
export function recentMessages(messages, maxMessages, maxCharacters) {
  /** @type {T[]} */
  const selected = [];
  let characters = 0;
  for (let index = messages.length - 1; index >= 0 && selected.length < maxMessages; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (selected.length && characters + message.content.length > maxCharacters) break;
    selected.unshift(message);
    characters += message.content.length;
  }
  return selected;
}
