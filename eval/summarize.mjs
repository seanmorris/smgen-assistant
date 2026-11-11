// @ts-check

import { readFile } from "node:fs/promises";
import { summarizeRecords } from "./metrics.mjs";

/** Format one ratio as a percentage. */
function percent(numerator, denominator) {
  return denominator ? `${Math.round((numerator / denominator) * 100)}%` : "—";
}

/** Show seconds only when the phase actually ran. */
function seconds(milliseconds) {
  return milliseconds == null ? "—" : `${(milliseconds / 1000).toFixed(3)} s`;
}

/** Print objective retrieval, fallback, and timing measurements by model. */
async function main() {
  const filename = process.argv[2];
  if (!filename) throw new Error("Pass an evaluation JSON file");
  const evaluation = JSON.parse(await readFile(filename, "utf8"));
  process.stdout.write("| Retrieval | Model | Cases | All expected retrieved | All expected fitted | Unrelated rejected | Generated accepted | Cold search | Warm search | Warm generation | Errors |\n");
  process.stdout.write("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n");
  for (const row of summarizeRecords(evaluation.records)) {
    process.stdout.write(`| ${row.mode} | ${row.model} | ${row.count} | ${percent(row.retrieved, row.positives)} | ${row.model === "retrieval only" ? "—" : percent(row.fitted, row.positives)} | ${percent(row.abstained, row.negatives)} | ${percent(row.accepted, row.generated)} | ${seconds(row.coldSearchMs)} | ${seconds(row.warmSearchMs)} | ${seconds(row.generationMs)} | ${row.errors} |\n`);
  }
}

await main();
