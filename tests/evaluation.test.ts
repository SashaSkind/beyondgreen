import assert from "node:assert/strict";
import test from "node:test";
import { summarizeEvaluation } from "../src/evaluation.ts";

test("evaluation keeps abstentions in the denominator and separates mistakes", () => {
  const rows = [
    { expected: "regression", verdict: "regression" },
    { expected: "regression", verdict: "clean" },
    { expected: "regression", verdict: "insufficient" },
    { expected: "clean", verdict: "clean" },
    { expected: "clean", verdict: "regression" },
    { expected: "clean", verdict: "insufficient" },
  ] as const;
  const result = summarizeEvaluation(rows.map((row) => ({ ...row, latencyMs: 100, usage: { inputTokens: 10, outputTokens: 5 } })));
  assert.deepEqual(result.confusion, { truePositive: 1, falsePositive: 1, trueNegative: 1, falseNegative: 1, abstainedRegression: 1, abstainedClean: 1 });
  assert.equal(result.accuracyAll, 2 / 6);
  assert.equal(result.coverage, 4 / 6);
  assert.equal(result.regressionRecallAll, 1 / 3);
  assert.equal(result.precision, 1 / 2);
  assert.equal(result.falsePositiveRateAll, 1 / 3);
  assert.equal(result.meanLatencyMs, 100);
  assert.deepEqual(result.usage, { inputTokens: 60, outputTokens: 30 });
  assert.equal(result.costUsd, null);
});

test("empty or undefined metric denominators stay unavailable", () => {
  assert.equal(summarizeEvaluation([]).accuracyAll, null);
  const summary = summarizeEvaluation([{ expected: "clean", verdict: "clean", latencyMs: 0, usage: { inputTokens: 0, outputTokens: 0 } }]);
  assert.equal(summary.precision, null);
  assert.equal(summary.regressionRecallAll, null);
  assert.equal(summary.accuracyAll, 1);
});
