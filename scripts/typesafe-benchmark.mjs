import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const CASES_PATH = path.join(ROOT, "benchmarks/typesafe/cases.v1.json");
const EXPECTED_PATH = path.join(ROOT, "benchmarks/typesafe/expected.v1.json");
const CONFIG_PATH = path.join(ROOT, "benchmarks/typesafe/routing.v1.json");
const RESULTS_DIR = path.join(ROOT, "benchmarks/typesafe/results");
const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const DEFAULT_MODELS = ["typesafe/jev-1.13", "~typesafe/jev-latest"];

/**
 * @typedef {object} BenchmarkCase
 * @property {string} id
 * @property {string} judgmentType
 * @property {unknown} state
 * @property {{ type: string, criteria: Record<string, string | undefined> }} question
 */

/**
 * @typedef {object} JudgmentAnswer
 * @property {string} choice
 * @property {number} confidence
 */

/**
 * @typedef {object} RoutingPolicy
 * @property {number} autoAcceptMin
 * @property {string[]} reviewChoices
 * @property {string[]} rejectChoices
 * @property {string} [alwaysRoute]
 */

/**
 * @typedef {object} RoutingConfig
 * @property {Record<string, RoutingPolicy>} judgmentTypes
 * @property {{ minimumJudgmentAccuracy: number, minimumRouteAccuracy: number, minimumAbstentionRecall: number, maximumConsequentialRoutingErrors: number }} qualityGates
 */

/**
 * @typedef {object} ScoredRecord
 * @property {string} id
 * @property {string} judgmentType
 * @property {string} expectedJudgment
 * @property {string} predictedJudgment
 * @property {string | null} expectedRoute
 * @property {string | null} predictedRoute
 * @property {number} confidence
 */

/**
 * @typedef {object} TypeSummary
 * @property {number} cases
 * @property {number | null} judgmentAccuracy
 * @property {number | null} routeAccuracy
 * @property {number} expectedAbstentions
 * @property {number | null} abstentionRecall
 * @property {string[]} consequentialRoutingErrors
 * @property {number | null} meanConfidence
 */

/**
 * @typedef {object} BenchmarkMetrics
 * @property {TypeSummary} overall
 * @property {Record<string, TypeSummary>} byJudgmentType
 * @property {{ judgmentAccuracy: boolean, routeAccuracy: boolean, abstentionRecall: boolean, consequentialRoutingErrors: boolean }} [qualityGates]
 * @property {boolean} [passed]
 */

/** @param {string[]} argv */
function parseArgs(argv) {
  const args = { models: DEFAULT_MODELS, raw: false, enforce: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--models") args.models = argv[++i].split(",").filter(Boolean);
    else if (argv[i] === "--raw") args.raw = true;
    else if (argv[i] === "--enforce") args.enforce = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

export function validateSuite(
  /** @type {BenchmarkCase[]} */ cases,
  /** @type {Record<string, { judgment: string, route: string }>} */ expectations,
) {
  const ids = new Set();
  for (const item of cases) {
    if (ids.has(item.id)) throw new Error(`Duplicate case id: ${item.id}`);
    ids.add(item.id);
    if (!expectations[item.id]) throw new Error(`Missing expectation: ${item.id}`);
    if (item.question.type !== "choice") throw new Error(`Only choice fixtures are supported: ${item.id}`);
    if (!(expectations[item.id].judgment in item.question.criteria)) {
      throw new Error(`Expected judgment is not a criterion: ${item.id}`);
    }
  }
  for (const id of Object.keys(expectations)) {
    if (!ids.has(id)) throw new Error(`Expectation has no case: ${id}`);
  }
}

/**
 * @param {string} apiKey
 * @param {string} model
 * @param {BenchmarkCase} item
 */
async function ask(apiKey, model, item) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, state: item.state, questions: { judgment: item.question } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${model}/${item.id}: OpenRouter returned ${response.status}`);
  const data = await response.json();
  const answer = data?.answers?.judgment;
  if (
    answer?.type !== "choice" ||
    typeof answer.choice !== "string" ||
    typeof answer.confidence !== "number" ||
    !answer.probabilities ||
    typeof answer.probabilities !== "object"
  ) {
    throw new Error(`${model}/${item.id}: malformed choice response`);
  }
  return {
    model: data.model,
    provider: data.provider,
    choice: answer.choice,
    confidence: answer.confidence,
    probabilities: answer.probabilities,
    usage: data.usage,
  };
}

export function routeFor(
  /** @type {BenchmarkCase} */ item,
  /** @type {JudgmentAnswer} */ answer,
  /** @type {RoutingConfig} */ config,
) {
  const policy = config.judgmentTypes[item.judgmentType];
  if (!policy) throw new Error(`No routing policy for ${item.judgmentType}`);
  if (policy.alwaysRoute) return policy.alwaysRoute;
  if (policy.rejectChoices.includes(answer.choice)) return "reject";
  if (policy.reviewChoices.includes(answer.choice)) return "human-review";
  return answer.confidence >= policy.autoAcceptMin ? "auto-accept" : "human-review";
}

/**
 * @param {number} numerator
 * @param {number} denominator
 */
function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

export function score(
  /** @type {ScoredRecord[]} */ records,
  /** @type {RoutingConfig} */ config,
) {
  /** @type {Record<string, ScoredRecord[]>} */
  const byType = {};
  for (const record of records) {
    const bucket = (byType[record.judgmentType] ??= []);
    bucket.push(record);
  }
  /** @param {ScoredRecord[]} rows */
  const summarize = (rows) => {
    const judgmentCorrect = rows.filter((r) => r.predictedJudgment === r.expectedJudgment).length;
    const routeCorrect = rows.filter((r) => r.predictedRoute === r.expectedRoute).length;
    const expectedAbstentions = rows.filter((r) => r.expectedRoute !== "auto-accept");
    const capturedAbstentions = expectedAbstentions.filter((r) => r.predictedRoute !== "auto-accept");
    const consequential = rows.filter(
      (r) =>
        (r.predictedRoute === "auto-accept" && r.expectedRoute !== "auto-accept") ||
        (r.predictedRoute === "reject" && r.expectedRoute === "auto-accept"),
    );
    return {
      cases: rows.length,
      judgmentAccuracy: ratio(judgmentCorrect, rows.length),
      routeAccuracy: ratio(routeCorrect, rows.length),
      expectedAbstentions: expectedAbstentions.length,
      abstentionRecall: ratio(capturedAbstentions.length, expectedAbstentions.length),
      consequentialRoutingErrors: consequential.map((r) => r.id),
      meanConfidence: ratio(rows.reduce((sum, r) => sum + r.confidence, 0), rows.length),
    };
  };
  /** @type {BenchmarkMetrics} */
  const metrics = { overall: summarize(records), byJudgmentType: {} };
  for (const [type, rows] of Object.entries(byType)) metrics.byJudgmentType[type] = summarize(rows);
  const gates = config.qualityGates;
  // Number(null) is 0, matching the previous `null >= gate` comparison outcome
  // for every numeric gate while satisfying strict null checks.
  metrics.qualityGates = {
    judgmentAccuracy: Number(metrics.overall.judgmentAccuracy) >= gates.minimumJudgmentAccuracy,
    routeAccuracy: Number(metrics.overall.routeAccuracy) >= gates.minimumRouteAccuracy,
    abstentionRecall: Number(metrics.overall.abstentionRecall) >= gates.minimumAbstentionRecall,
    consequentialRoutingErrors:
      metrics.overall.consequentialRoutingErrors.length <= gates.maximumConsequentialRoutingErrors,
  };
  metrics.passed = Object.values(metrics.qualityGates).every(Boolean);
  return metrics;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required");
  const casesFile = JSON.parse(await readFile(CASES_PATH, "utf8"));
  const expectedFile = JSON.parse(await readFile(EXPECTED_PATH, "utf8"));
  const config = args.raw ? null : JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  validateSuite(casesFile.cases, expectedFile.expectations);
  await mkdir(RESULTS_DIR, { recursive: true });
  let failed = false;
  for (const requestedModel of args.models) {
    const records = [];
    for (const item of casesFile.cases) {
      const answer = await ask(apiKey, requestedModel, item);
      const expected = expectedFile.expectations[item.id];
      records.push({
        id: item.id,
        judgmentType: item.judgmentType,
        scenario: item.scenario,
        expectedJudgment: expected.judgment,
        predictedJudgment: answer.choice,
        expectedRoute: expected.route,
        predictedRoute: config ? routeFor(item, answer, config) : null,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
        resolvedModel: answer.model,
        provider: answer.provider,
        usage: answer.usage,
      });
    }
    const metrics = config ? score(records, config) : null;
    const report = {
      benchmarkVersion: casesFile.version,
      expectationVersion: expectedFile.version,
      routingVersion: config?.version ?? null,
      requestedModel,
      runAt: new Date().toISOString(),
      records,
      metrics,
    };
    const filename = `${requestedModel.replace(/[^a-z0-9.-]+/gi, "_")}.json`;
    await writeFile(path.join(RESULTS_DIR, filename), `${JSON.stringify(report, null, 2)}\n`);
    if (config && metrics) {
      console.log(
        `${requestedModel}: judgment=${Number(metrics.overall.judgmentAccuracy).toFixed(3)} route=${Number(metrics.overall.routeAccuracy).toFixed(3)} consequential=${metrics.overall.consequentialRoutingErrors.length} passed=${metrics.passed}`,
      );
      if (!metrics.passed) failed = true;
    } else {
      console.log(`${requestedModel}: captured ${records.length} raw judgments`);
    }
  }
  if (args.enforce && failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
