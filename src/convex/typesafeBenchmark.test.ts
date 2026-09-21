import { expect, test } from "vitest";
import casesFile from "../../benchmarks/typesafe/cases.v1.json";
import expectedFile from "../../benchmarks/typesafe/expected.v1.json";
import routingConfig from "../../benchmarks/typesafe/routing.v1.json";
import { routeFor, score, validateSuite } from "../../scripts/typesafe-benchmark.mjs";

type Case = (typeof casesFile.cases)[number];
type Config = typeof routingConfig;

const policyType = "evidence-location";

function answer(choice: string, confidence: number) {
  return { choice, confidence };
}

test("v1 fixtures and expectations are mutually consistent", () => {
  expect(() => validateSuite(casesFile.cases, expectedFile.expectations)).not.toThrow();
});

test("every fixture judgment type has an explicit routing policy", () => {
  const types = new Set(casesFile.cases.map((c) => c.judgmentType));
  for (const type of types) {
    expect(
      (routingConfig.judgmentTypes as Record<string, unknown>)[type],
      `missing routing policy for ${type}`,
    ).toBeDefined();
  }
});

test("every expected route is a known application route", () => {
  const routes = new Set(["auto-accept", "human-review", "reject", "confirm-user"]);
  for (const [id, exp] of Object.entries(
    expectedFile.expectations as Record<string, { judgment: string; route: string }>,
  )) {
    expect(routes.has(exp.route), `${id} has unknown route ${exp.route}`).toBe(true);
  }
});

test("validateSuite rejects duplicate case ids", () => {
  const dupes = [casesFile.cases[0], casesFile.cases[0]];
  expect(() => validateSuite(dupes, expectedFile.expectations)).toThrow(/Duplicate case id/);
});

test("validateSuite rejects a case without an expectation", () => {
  const expectations = {
    ...(expectedFile.expectations as Record<string, { judgment: string; route: string }>),
  };
  delete expectations[casesFile.cases[0].id];
  expect(() => validateSuite(casesFile.cases, expectations)).toThrow(/Missing expectation/);
});

test("validateSuite rejects an expectation without a case", () => {
  const expectations = { ...expectedFile.expectations, ghost: { judgment: "x", route: "y" } };
  expect(() => validateSuite(casesFile.cases, expectations)).toThrow(/no case/);
});

test("reject choices take precedence over confidence", () => {
  const item = casesFile.cases.find(
    (c) => c.id === "evidence-adversarial-injection",
  ) as unknown as Case;
  expect(routeFor(item, answer("adversarial", 0.99), routingConfig as Config)).toBe("reject");
});

test("review choices route to human review even at high confidence", () => {
  const item = casesFile.cases.find((c) => c.id === "evidence-absent-age") as unknown as Case;
  expect(routeFor(item, answer("absent", 1.0), routingConfig as Config)).toBe("human-review");
});

test("profile interpretations always require user confirmation", () => {
  const item = casesFile.cases.find((c) => c.id === "profile-clear-location") as unknown as Case;
  expect(routeFor(item, answer("Kano", 1.0), routingConfig as Config)).toBe("confirm-user");
  expect(routeFor(item, answer("unknown", 0.1), routingConfig as Config)).toBe("confirm-user");
});

test("confidence threshold gates auto-accept", () => {
  const item = casesFile.cases.find((c) => c.id === "evidence-clear-support") as unknown as Case;
  const min = (routingConfig.judgmentTypes as Record<string, { autoAcceptMin: number }>)[
    policyType
  ].autoAcceptMin;
  expect(routeFor(item, answer("supports", min), routingConfig as Config)).toBe("auto-accept");
  expect(routeFor(item, answer("supports", min - 0.01), routingConfig as Config)).toBe(
    "human-review",
  );
});

function record(overrides: Record<string, unknown>) {
  return {
    id: "x",
    judgmentType: policyType,
    scenario: "clear",
    expectedJudgment: "supports",
    predictedJudgment: "supports",
    expectedRoute: "auto-accept",
    predictedRoute: "auto-accept",
    confidence: 0.9,
    ...overrides,
  };
}

test("score detects consequential auto-accept of a case meant for review", () => {
  const metrics = score(
    [record({ expectedRoute: "human-review", predictedRoute: "auto-accept" })],
    routingConfig as Config,
  );
  expect(metrics.overall.consequentialRoutingErrors).toEqual(["x"]);
  expect(metrics.overall.routeAccuracy).toBe(0);
  expect(metrics.passed).toBe(false);
});

test("score measures abstention recall over expected non-accepts", () => {
  const metrics = score(
    [
      record({ id: "a", expectedRoute: "human-review", predictedRoute: "human-review" }),
      record({ id: "b", expectedRoute: "human-review", predictedRoute: "auto-accept" }),
    ],
    routingConfig as Config,
  );
  expect(metrics.overall.abstentionRecall).toBe(0.5);
  expect(metrics.overall.consequentialRoutingErrors).toEqual(["b"]);
});

test("score passes a clean run through the configured quality gates", () => {
  const metrics = score(
    [
      record({ id: "a" }),
      record({
        id: "b",
        expectedJudgment: "absent",
        predictedJudgment: "absent",
        expectedRoute: "human-review",
        predictedRoute: "human-review",
      }),
    ],
    routingConfig as Config,
  );
  expect(metrics.overall.judgmentAccuracy).toBe(1);
  expect(metrics.overall.routeAccuracy).toBe(1);
  expect(metrics.passed).toBe(true);
});
