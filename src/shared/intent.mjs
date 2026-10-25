// @ts-check

const INTENT_ORDER = ["what", "why", "where", "when", "how", "who"];
const HOW_REPHRASE = /\bwhat(?:'s| is)\s+(?:the\s+)?(?:(?:right|best|recommended)\s+)?way\b|\bwhat should (?:i|we|you)\s+(?:do|run|set|use|write)\b|\bwhat\s+(?:commands?|files?|steps?|settings?)\b[^?]*\b(?:do|does|should|need|required)\b/iu;

/**
 * Identify the answer forms explicitly requested by a reader's question.
 *
 * @param {string} question
 * @returns {string[]}
 */
export function questionIntents(question) {
  const value = question.normalize("NFKC").toLocaleLowerCase("en-US");
  const detected = new Set();
  if (/\bwhy\b|\b(?:reason|rationale)\s+(?:for|behind)\b/u.test(value)) detected.add("why");
  if (/\bwhere\b|\bwhich\s+(?:directory|file|folder|location|page|path|place|url)\b/u.test(value)) detected.add("where");
  if (/\bwhen\b|\bwhat\s+(?:condition|time|date)\b/u.test(value)) detected.add("when");
  if (/\bhow\b|\bwalk me through\b|\b(?:steps?|instructions?|procedure)\b/u.test(value) || HOW_REPHRASE.test(value)) detected.add("how");
  if (/\bwho\b|\bwhich\s+(?:actor|person|role|team|user)\b/u.test(value)) detected.add("who");
  if ((/\bwhat\b|\bdefine\b|\bdefinition\b|\bdescribe\b|\btell me about\b/u.test(value) && !HOW_REPHRASE.test(value)) || /\bexplain\s+(?:the|this|that|why|what)\b/u.test(value)) {
    detected.add("what");
  }
  return INTENT_ORDER.filter((intent) => detected.has(intent));
}

/**
 * Explain to the model how the detected question form should shape its answer.
 *
 * @param {string} question
 * @returns {string}
 */
export function questionIntentInstruction(question) {
  /** @type {Record<string, string>} */
  const instructions = {
    what: "WHAT: state the documented identity, behavior, or value.",
    why: "WHY: state only the documented reason.",
    where: "WHERE: name the documented location, path, or URL.",
    when: "WHEN: state the documented time or condition.",
    how: "HOW: give the documented method or actions in order.",
    who: "WHO: name the documented person, role, or actor."
  };
  const intents = questionIntents(question);
  if (!intents.length) return "";
  return intents.map((intent) => instructions[intent]).filter(Boolean).join(" ");
}
