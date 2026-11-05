// @ts-check

import { sourceMatches } from "./source-match.mjs";

/** Return the median of finite timings, or null without measurements. @param {number[]} values */
function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Summarize experiments without dropping errors or treating abstentions as generations.
 * @param {Array<Record<string, any>>} records
 */
export function summarizeRecords(records) {
  /** @type {Map<string, Array<Record<string, any>>>} */
  const groups = new Map();
  for (const record of records) {
    const mode = record.retrievalMode ?? record.telemetry?.retrieval?.mode ?? "lexical";
    const key = JSON.stringify([mode, record.modelId ?? "retrieval only"]);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return [...groups].map(([key, group]) => {
    const [mode, model] = JSON.parse(key);
    const positives = group.filter((record) => record.expectedSources?.length);
    const negatives = group.filter((record) => record.expectedSources?.length === 0);
    /** Match every expected URL at a pipeline stage. @param {Record<string, any>} record @param {string} field */
    const allExpected = (record, field) => !record.error && !record.telemetry?.error && record.expectedSources.every((/** @type {string} */ expected) =>
      record.telemetry?.[field]?.some((/** @type {{url: string}} */ source) => sourceMatches(source.url, expected)));
    const successful = group.filter((record) => record.telemetry && !record.error && !record.telemetry.error);
    const generated = successful.filter((record) => typeof record.telemetry.rawAnswer === "string" && record.telemetry.rawAnswer.length > 0);
    return {
      mode, model, count: group.length, positives: positives.length,
      retrieved: positives.filter((record) => allExpected(record, "retrievedSources")).length,
      fitted: positives.filter((record) => allExpected(record, "fittedSources")).length,
      negatives: negatives.length,
      abstained: negatives.filter((record) => !record.error && !record.telemetry?.error && record.telemetry?.retrievedSources?.length === 0).length,
      generated: generated.length,
      accepted: generated.filter((record) => record.telemetry.fallback === false).length,
      errors: group.length - successful.length,
      coldSearchMs: median(successful.filter((record) => record.telemetry.retrieval?.cold).map((record) => record.telemetry.retrieval.milliseconds)),
      warmSearchMs: median(successful.filter((record) => record.telemetry.retrieval?.cold === false).map((record) => record.telemetry.retrieval.milliseconds)),
      generationMs: median(generated.filter((record) => record.telemetry.timing?.reusedEngine).map((record) => record.telemetry.timing.generationMs))
    };
  });
}
