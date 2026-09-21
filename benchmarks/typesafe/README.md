# TypeSafe judgment benchmark (v1)

Versioned evaluation set for the TypeSafe judgments Backbone relies on:
evidence location, criterion classification, requirement strength, ambiguity,
citation support, and natural profile interpretation.

## Files

- `cases.v1.json` — 19 fixtures across clear, ambiguous, absent,
  contradictory, and adversarial scenarios, drawn from representative
  opportunity language (women-led funds, CAC registration, state operation,
  deadlines, fees). Each case records the judgment type, scenario, evaluator
  state, and a single `choice` question.
- `expected.v1.json` — expected judgment and expected application route per
  case, recorded separately. Routes are `auto-accept`, `human-review`,
  `reject`, or `confirm-user` (profile interpretations always confirm).
- `routing.v1.json` — explicit routing policy: per-type `autoAcceptMin`
  confidence thresholds plus choice-specific review/reject overrides, and the
  quality gates a run must pass.
- `results/` — scored baseline reports (judgment + route accuracy,
  abstention recall, consequential routing errors, per-type breakdown).

## Rerunning

Requires `OPENROUTER_API_KEY` in the environment.

```sh
# Capture raw judgments only (no scoring, no gates)
node scripts/typesafe-benchmark.mjs --raw

# Score against routing.v1.json and enforce quality gates (exit 1 on failure)
node scripts/typesafe-benchmark.mjs --enforce
npm run benchmark:typesafe

# Target specific models (default: pinned + alias)
node scripts/typesafe-benchmark.mjs --enforce --models typesafe/jev-1.13
node scripts/typesafe-benchmark.mjs --enforce --models ~typesafe/jev-latest
```

Always rerun against both the pinned model (`typesafe/jev-1.13`) and the
current alias (`~typesafe/jev-latest`) so drift in the alias is visible.

## Threshold derivation

Thresholds in `routing.v1.json` were set from the observed confidence
distributions of the v1 baseline run (2026-09-19), not copied from cookbook
examples: each per-type `autoAcceptMin` separates the lowest-confidence
correct auto-accept case from the highest-confidence unsafe auto-accept
observed. Choice-specific review/reject routes take precedence over
confidence, and sensitive profile outputs always route to user confirmation.
Quality gates require ≥0.80 judgment accuracy, ≥0.95 route accuracy, full
abstention recall, and zero consequential routing errors.

## Offline tests

The pure logic (`validateSuite`, `routeFor`, `score`) is unit-tested without
network access in `src/convex/typesafeBenchmark.test.ts`.
