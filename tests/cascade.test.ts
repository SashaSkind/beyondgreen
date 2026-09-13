import assert from "node:assert/strict";
import test from "node:test";
import { escalate } from "../src/investigation/cascade.ts";
import type { Investigation } from "../src/investigation/engine.ts";
import type { Verdict } from "../src/investigation/types.ts";

function outcome(verdict: Verdict, reason: string, latencyMs = 10): Investigation {
  return {
    verdict, reason, scope: "observed operation only", hypotheses: [], evidenceIds: [], retrieved: {},
    steps: [], usage: { inputTokens: 100, outputTokens: 10 }, latencyMs, minConfidence: 0.8, costUsd: null,
  };
}

function attempt(tier: string, result: Investigation, calls: string[]) {
  return { tier, run: async () => { calls.push(tier); return result; } };
}

test("a tier that answers stops the cascade before the expensive one runs", async () => {
  const calls: string[] = [];
  const result = await escalate([
    attempt("cheap", outcome("regression", "verified"), calls),
    attempt("expensive", outcome("clean", "verified"), calls),
  ]);
  assert.deepEqual(calls, ["cheap"]);
  assert.equal(result.final.verdict, "regression");
  assert.equal(result.finalTier, "cheap");
  assert.equal(result.escalations, 0);
  assert.equal(result.flipped, false);
});

test("an abstention escalates and the recovered verdict is recorded as a flip", async () => {
  const calls: string[] = [];
  const result = await escalate([
    attempt("cheap", outcome("insufficient", "critic_unconvinced"), calls),
    attempt("expensive", outcome("regression", "verified"), calls),
  ]);
  assert.deepEqual(calls, ["cheap", "expensive"]);
  assert.equal(result.final.verdict, "regression");
  assert.equal(result.finalTier, "expensive");
  assert.equal(result.escalations, 1);
  assert.equal(result.flipped, true);
  assert.equal(result.attempts[0].verdict, "insufficient");
  assert.equal(result.attempts[0].reason, "critic_unconvinced");
});

test("every tier abstaining leaves the last result rather than inventing one", async () => {
  const calls: string[] = [];
  const result = await escalate([
    attempt("cheap", outcome("insufficient", "critic_unconvinced"), calls),
    attempt("expensive", outcome("insufficient", "model_error"), calls),
  ]);
  assert.deepEqual(calls, ["cheap", "expensive"]);
  assert.equal(result.final.verdict, "insufficient");
  assert.equal(result.final.reason, "model_error");
  assert.equal(result.escalations, 1);
  assert.equal(result.flipped, false);
});

test("a confident finding can be escalated for confirmation when asked", async () => {
  const calls: string[] = [];
  const result = await escalate([
    attempt("cheap", outcome("regression", "verified"), calls),
    attempt("expensive", outcome("clean", "verified"), calls),
  ], { escalateOn: ["insufficient", "regression"] });
  assert.deepEqual(calls, ["cheap", "expensive"]);
  assert.equal(result.final.verdict, "clean");
  assert.equal(result.flipped, true);
});

test("the cascade totals what every tier spent, not only the tier that answered", async () => {
  const calls: string[] = [];
  const result = await escalate([
    attempt("cheap", outcome("insufficient", "critic_unconvinced", 5), calls),
    attempt("expensive", outcome("clean", "verified", 90), calls),
  ]);
  assert.equal(result.totalLatencyMs, 95);
  assert.deepEqual(result.totalUsage, { inputTokens: 200, outputTokens: 20 });
});

test("an empty cascade is rejected rather than returning nothing", async () => {
  await assert.rejects(escalate([]), /at least one tier/i);
});
