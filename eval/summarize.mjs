// @ts-check

import { readFile } from "node:fs/promises";
import { sourceMatches } from "./source-match.mjs";

/** Return the median numeric value or zero for an empty list. */
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Format one ratio as a percentage. */
function percent(numerator, denominator) {
  return denominator ? `${Math.round((numerator / denominator) * 100)}%` : "0%";
}

/** Print objective retrieval, fallback, and timing measurements by model. */
async function main() {
  const filename = process.argv[2];
  if (!filename) throw new Error("Pass an evaluation JSON file");
  const evaluation = JSON.parse(await readFile(filename, "utf8"));
  const models = [...new Set(evaluation.records.map((record) => record.modelId))];
  process.stdout.write("| Model | Answers | Expected retrieval | All expected | Generated accepted | Median warm generation | Median decode | Errors |\n");
  process.stdout.write("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n");
  for (const model of models) {
    const records = evaluation.records.filter((record) => record.modelId === model);
    const answered = records.filter((record) => record.telemetry && !record.error);
    const expectedHit = answered.filter((record) => record.expectedSources.some((url) => record.telemetry.fittedSources.some((source) => sourceMatches(source.url, url)))).length;
    const allExpected = answered.filter((record) => record.expectedSources.every((url) => record.telemetry.fittedSources.some((source) => sourceMatches(source.url, url)))).length;
    const accepted = answered.filter((record) => !record.telemetry.fallback).length;
    const warmGeneration = answered.filter((record) => record.telemetry.timing.reusedEngine).map((record) => record.telemetry.timing.generationMs);
    const decode = answered.map((record) => record.telemetry.usage?.extra?.decode_tokens_per_s).filter((value) => Number.isFinite(value));
    process.stdout.write(`| ${model} | ${answered.length} | ${percent(expectedHit, answered.length)} | ${percent(allExpected, answered.length)} | ${percent(accepted, answered.length)} | ${(median(warmGeneration) / 1000).toFixed(1)} s | ${median(decode).toFixed(1)} tok/s | ${records.length - answered.length} |\n`);
  }
}

await main();
