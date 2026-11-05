// @ts-check

import { readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";
import { createSemanticSearch, LocalEmbeddings } from "../src/shared/semantic.mjs";
import { selectRetrievedChunks } from "../src/shared/hybrid-retrieval.mjs";
import { questionUsesPreviousContext } from "../src/shared/prompt.mjs";

/** Run a reproducible local search comparison before the browser/CDP evaluation. */
async function main() {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i += 2) {
    if (!process.argv[i]?.startsWith("--") || !process.argv[i + 1]) throw new Error("Expected --name value arguments");
    args.set(process.argv[i], process.argv[i + 1]);
  }
  const directory = args.get("--assets") ?? "docs/__smgen-assistant";
  const output = args.get("--output") ?? "/tmp/smgen-assistant-retrieval.json";
  const corpus = JSON.parse(await readFile(`${directory}/corpus.json`, "utf8"));
  const config = JSON.parse(await readFile(`${directory}/config.json`, "utf8"));
  const index = JSON.parse(await readFile(`${directory}/semantic-index.json`, "utf8"));
  const matrix = parse(await readFile(args.get("--questions") ?? "eval/assistant-questions.yaml", "utf8"));
  const cases = matrix.roles.flatMap((role) => role.scenarios.flatMap((scenario) => scenario.variants.map((question, variant) => ({
    id: `${scenario.id}-${variant + 1}`, questions: [{ question, expectedSources: scenario.expectedSources, requiredFacts: scenario.requiredFacts }]
  }))));
  cases.push(...(matrix.conversationSequences ?? []).map((sequence) => ({ id: sequence.id, questions: sequence.turns })));
  const result = { version: 2, runtime: "node", assetVersion: config.assetVersion, embedding: index.embedding, startedAt: new Date().toISOString(), records: [] };
  const embeddings = new LocalEmbeddings();
  try {
    const search = await createSemanticSearch(corpus.chunks, index, embeddings);
    // Cache query embeddings across modes so each experiment uses identical vectors.
    const queries = new Map();
    for (const mode of ["lexical", "semantic", "hybrid"]) {
      for (const testCase of cases) {
        let previous = "";
        for (const [turn, expected] of testCase.questions.entries()) {
          const startedAt = performance.now();
          const previousQuery = questionUsesPreviousContext(expected.question) ? previous : "";
          const query = previousQuery ? `${previousQuery} ${expected.question}` : expected.question;
          const record = { modelId: null, retrievalMode: mode, caseId: testCase.id, turn: turn + 1, ...expected };
          try {
            if (mode !== "lexical" && !queries.has(query)) queries.set(query, await search(query));
            const chunks = selectRetrievedChunks(corpus.chunks, expected.question, { ...config.retrieval, previousQuery }, mode, queries.get(query) ?? []);
            record.telemetry = { kind: "retrieval", retrievedSources: chunks.map(({ id, heading, url }) => ({ id, heading, url })),
              retrieval: { mode, milliseconds: Math.round(performance.now() - startedAt), semanticCandidates: queries.get(query) ?? [], cachedQueries: true } };
          } catch (error) {
            record.error = error instanceof Error ? error.message : String(error);
          }
          result.records.push(record);
          previous = expected.question;
        }
      }
    }
  } finally {
    await embeddings.dispose();
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  }
  process.stdout.write(`${output}\n`);
  if (result.records.some((record) => record.error)) process.exitCode = 1;
}

await main();
