// @ts-check

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { chromium } from "playwright-core";
import { parse as parseYaml } from "yaml";

/** Parse command-line flags with one value each. */
function options() {
  const values = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index];
    const value = process.argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) throw new Error(`Expected a value after ${name ?? "argument"}`);
    values.set(name, value);
  }
  const models = (values.get("--models") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!models.length) throw new Error("Pass one or more comma-separated model IDs with --models");
  return {
    cdp: values.get("--cdp") ?? "http://172.19.0.1:9223",
    url: values.get("--url") ?? "http://localhost:9000/__smgen-assistant/frame.html?evaluation=1",
    output: values.get("--output") ?? `/tmp/smgen-assistant-eval-${Date.now()}.json`,
    variants: values.get("--variants") ?? "first",
    scenarios: new Set((values.get("--scenarios") ?? "").split(",").map((value) => value.trim()).filter(Boolean)),
    sequences: values.get("--sequences") === "true",
    clearHttpCache: values.get("--clear-http-cache") === "true",
    models
  };
}

/** Turn the YAML matrix into independent questions and optional conversations. */
function evaluationCases(matrix, settings) {
  const cases = [];
  for (const role of matrix.roles ?? []) {
    for (const scenario of role.scenarios ?? []) {
      if (settings.scenarios.size && !settings.scenarios.has(scenario.id)) continue;
      const variants = settings.variants === "all" ? scenario.variants : scenario.variants.slice(0, 1);
      for (const [index, question] of variants.entries()) {
        cases.push({
          id: `${scenario.id}-${index + 1}`,
          role: role.id,
          scenario: scenario.id,
          questions: [{ question, expectedSources: scenario.expectedSources, requiredFacts: scenario.requiredFacts }]
        });
      }
    }
  }
  if (settings.sequences) {
    for (const sequence of matrix.conversationSequences ?? []) {
      cases.push({
        id: sequence.id,
        role: sequence.role,
        scenario: sequence.id,
        questions: sequence.turns.map((turn) => ({ ...turn, requiredFacts: [] }))
      });
    }
  }
  return cases;
}

/** Save the partial result after every answer so an interrupted run can be inspected. */
async function save(output, result) {
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
}

/** Read the next evaluation event emitted by the frame. */
async function nextResult(page, previousCount) {
  await page.waitForFunction((count) => window.__smgenEvaluationResults?.length > count, previousCount, { timeout: 10 * 60 * 1000 });
  return page.evaluate((index) => window.__smgenEvaluationResults[index], previousCount);
}

/** Submit one question and return structured frame telemetry. */
async function ask(page, question) {
  const count = await page.evaluate(() => window.__smgenEvaluationResults.length);
  await page.locator("#question").fill(question);
  await page.locator("#submit").click();
  return nextResult(page, count);
}

/**
 * Open an isolated evaluation page with a listener for structured result events.
 *
 * @param {import("playwright-core").BrowserContext} context
 * @param {string} url
 * @returns {Promise<import("playwright-core").Page>}
 */
async function openEvaluationPage(context, url) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__smgenEvaluationResults = [];
    window.addEventListener("message", (event) => {
      if (event.origin === location.origin && event.data?.type === "smgen-assistant:evaluation-result") {
        window.__smgenEvaluationResults.push(event.data);
      }
    });
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator("#question:not([disabled])").waitFor({ timeout: 30_000 });
  return page;
}

/**
 * Remove one completed model from browser storage and verify no records remain.
 *
 * @param {import("playwright-core").BrowserContext} context
 * @param {string} url
 * @param {string} modelId
 * @returns {Promise<{deletedRecords: number, remainingRecords: number}>}
 */
async function deleteModelFromDisk(context, url, modelId) {
  const page = await openEvaluationPage(context, url);
  try {
    const cleanup = await page.evaluate(async (completedModelId) => {
      if (!window.__smgenEvaluationDeleteModel) throw new Error("The evaluation cleanup hook is unavailable.");
      return window.__smgenEvaluationDeleteModel(completedModelId);
    }, modelId);
    if (cleanup.remainingRecords !== 0) throw new Error(`${cleanup.remainingRecords} records remain for ${modelId}.`);
    return cleanup;
  } finally {
    await page.close();
  }
}

/**
 * Clear Chromium's ordinary HTTP cache in a disposable evaluation profile.
 *
 * @param {import("playwright-core").BrowserContext} context
 * @returns {Promise<void>}
 */
async function clearBrowserHttpCache(context) {
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  try {
    await session.send("Network.clearBrowserCache");
  } finally {
    await session.detach();
    await page.close();
  }
}

/**
 * Exercise one model while its WebLLM worker is the only evaluation worker alive.
 *
 * @param {import("playwright-core").Page} page
 * @param {string} modelId
 * @param {ReturnType<typeof evaluationCases>} cases
 * @param {{records: Array<Record<string, unknown>>}} result
 * @param {string} output
 */
async function evaluateModel(page, modelId, cases, result, output) {
  const available = await page.locator("#model-select option").evaluateAll((items) => items.map((item) => item.value));
  if (!available.includes(modelId)) throw new Error(`${modelId} is absent from the generated evaluation config`);
  await page.locator("#model-select").selectOption(modelId);
  await page.locator("#model-select:not([disabled])").waitFor();
  for (const testCase of cases) {
    await page.locator("#new-chat").click();
    await page.waitForTimeout(250);
    for (const [turn, expected] of testCase.questions.entries()) {
      process.stdout.write(`${modelId} ${testCase.id} turn ${turn + 1}\n`);
      try {
        const telemetry = await ask(page, expected.question);
        const record = { modelId, caseId: testCase.id, role: testCase.role, scenario: testCase.scenario, turn: turn + 1, ...expected, telemetry };
        if (telemetry.error) record.error = `${telemetry.error.name}: ${telemetry.error.message}`;
        result.records.push(record);
      } catch (error) {
        result.records.push({
          modelId,
          caseId: testCase.id,
          role: testCase.role,
          scenario: testCase.scenario,
          turn: turn + 1,
          ...expected,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        });
      }
      await save(output, result);
    }
  }
}

/** Run the selected matrix against every requested model with isolated workers. */
async function main() {
  const settings = options();
  if (!new Set(["first", "all"]).has(settings.variants)) throw new Error("--variants must be first or all");
  const matrix = parseYaml(await readFile(new URL("questions.yaml", import.meta.url), "utf8"));
  const cases = evaluationCases(matrix, settings);
  const result = {
    version: 1,
    startedAt: new Date().toISOString(),
    settings: { ...settings, scenarios: [...settings.scenarios] },
    cases: cases.length,
    records: [],
    cleanups: []
  };
  const browser = await chromium.connectOverCDP(settings.cdp);
  const context = browser.contexts()[0];
  if (!context) throw new Error("The CDP browser has no context");
  try {
    for (const modelId of settings.models) {
      const page = await openEvaluationPage(context, settings.url);
      try {
        await evaluateModel(page, modelId, cases, result, settings.output);
      } finally {
        process.stdout.write(`${modelId} releasing model and worker\n`);
        await page.close();
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        process.stdout.write(`${modelId} deleting cached files\n`);
        const cleanup = await deleteModelFromDisk(context, settings.url, modelId);
        if (settings.clearHttpCache) await clearBrowserHttpCache(context);
        result.cleanups.push({ modelId, ...cleanup, httpCacheCleared: settings.clearHttpCache, finishedAt: new Date().toISOString() });
        await save(settings.output, result);
        const cacheDetail = settings.clearHttpCache ? " and HTTP cache cleared" : "";
        process.stdout.write(`${modelId} deleted from disk (${cleanup.deletedRecords} residual records removed${cacheDetail})\n`);
      }
    }
  } finally {
    result.finishedAt = new Date().toISOString();
    await save(settings.output, result);
    await browser.close();
  }
  process.stdout.write(`${settings.output}\n`);
}

await main();
