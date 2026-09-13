import assert from "node:assert/strict";
import test from "node:test";
import { investigate } from "../src/investigation/engine.ts";
import type { EvidenceKey, EvidenceSource, Json, Judge, Judgment } from "../src/investigation/types.ts";

function judgment(choices: Record<string, string>, confidence = 0.95): Judgment {
  return { model: "test-double", latencyMs: 1, usage: { inputTokens: 10, outputTokens: 2 },
    answers: Object.fromEntries(Object.entries(choices).map(([key, choice]) => [key, { choice, confidence, probabilities: { [choice]: 1 } }])) };
}
function source(): EvidenceSource & { requested: EvidenceKey[]; required: EvidenceKey[] } {
  const requested: EvidenceKey[] = [];
  return {
    initial: { test: { passed: true }, counts: { before: 9, after: 8 } },
    catalog: { database_state: "Recorded state", operation_contract: "Required behavior", known_good_run: "Reference observations" },
    required: ["database_state", "operation_contract"],
    requested,
    async retrieve(key) {
      requested.push(key);
      return { source: key, observed: true };
    },
  };
}
function scripted(responses: Judgment[], states: Json[] = []): Judge {
  return async (state) => {
    states.push(structuredClone(state));
    assert.ok(responses.length > 0, "Unexpected extra model call");
    return responses.shift()!;
  };
}
function flow(final: "clean" | "regression"): Judgment[] {
  const hypothesis = final === "clean" ? "consistent" : "suspected_violation";
  return [
    judgment({ hypothesis: "consistent" }),
    judgment({ assessment: "insufficient", next_evidence: "database_state" }),
    judgment({ hypothesis }),
    judgment({ assessment: "insufficient", next_evidence: "operation_contract" }),
    judgment({ hypothesis }),
    judgment({ assessment: "supported", next_evidence: "none" }),
    judgment({ verdict: final, grounding: "sufficient" }),
  ];
}

test("critic retrieves evidence and investigator revises before a verified regression", async () => {
  const evidence = source();
  const states: Json[] = [];
  const result = await investigate(evidence, scripted(flow("regression"), states));
  assert.equal(result.verdict, "regression");
  assert.deepEqual(evidence.requested, ["database_state", "operation_contract"]);
  function retrieved(index: number): Record<string, Json> {
    const state = states[index];
    assert.ok(state && typeof state === "object" && !Array.isArray(state));
    const value = state.retrieved;
    assert.ok(value && typeof value === "object" && !Array.isArray(value));
    return value;
  }
  assert.equal(retrieved(0).database_state, undefined);
  assert.deepEqual(retrieved(2).database_state, { source: "database_state", observed: true });
  assert.deepEqual(result.hypotheses, ["consistent", "suspected_violation", "suspected_violation"]);
  assert.deepEqual(result.evidenceIds, ["database_state", "operation_contract"]);
  assert.equal(result.usage.inputTokens, 70);
});

test("a count decrease does not force a regression when the model verifies permitted removal", async () => {
  const evidence = source();
  evidence.retrieve = async (key): Promise<Json> => key === "operation_contract"
    ? { operation: "delete", requirement: "Remove the requested row" }
    : { before: [{ id: 2 }], after: [] };
  const result = await investigate(evidence, scripted(flow("clean")));
  assert.equal(result.verdict, "clean");
});

test("unchanged counts do not force clean when the target is replaced", async () => {
  const evidence = source();
  evidence.initial = { counts: { before: 9, after: 9 } };
  const result = await investigate(evidence, scripted(flow("regression")));
  assert.equal(result.verdict, "regression");
});

test("high confidence cannot bypass missing contract and database evidence", async () => {
  const evidence = source();
  const result = await investigate(evidence, scripted([
    judgment({ hypothesis: "suspected_violation" }),
    judgment({ assessment: "supported", next_evidence: "none" }),
  ]));
  assert.equal(result.verdict, "insufficient");
  assert.deepEqual(evidence.requested, []);
});

test("retrieval failure remains insufficient instead of becoming empty evidence", async () => {
  const evidence = source();
  evidence.retrieve = async () => { throw new Error("missing snapshot"); };
  const result = await investigate(evidence, scripted([
    judgment({ hypothesis: "unknown" }),
    judgment({ assessment: "insufficient", next_evidence: "database_state" }),
  ]));
  assert.equal(result.verdict, "insufficient");
  assert.equal(result.reason, "retrieval_error");
});

test("low verifier confidence produces an inconclusive result", async () => {
  const responses = flow("regression");
  responses[responses.length - 1] = judgment({ verdict: "regression", grounding: "sufficient" }, 0.4);
  const result = await investigate(source(), scripted(responses));
  assert.equal(result.verdict, "insufficient");
});

test("a model service failure cannot become a clean verdict", async () => {
  const result = await investigate(source(), async () => { throw new Error("HTTP 503"); });
  assert.equal(result.verdict, "insufficient");
  assert.equal(result.reason, "model_error");
});

test("a dissenting verifier cannot confirm the investigator's hypothesis", async () => {
  const responses = flow("regression");
  responses[responses.length - 1] = judgment({ verdict: "clean", grounding: "sufficient" });
  const result = await investigate(source(), scripted(responses));
  assert.equal(result.verdict, "insufficient");
  assert.equal(result.reason, "verification_disagreed");
});

test("the round budget bounds investigation without forcing a verdict", async () => {
  const result = await investigate(source(), scripted(flow("regression").slice(0, 3)), { maxRounds: 1 });
  assert.equal(result.verdict, "insufficient");
  assert.equal(result.reason, "budget_exhausted");
  assert.equal(result.steps.length, 3);
});

// Observed live: two abstentions reported "incomplete_evidence" while both
// required sources had in fact been retrieved. The Critic had simply failed the
// confidence gate (supported@0.65, refuted@0.46) and then asked for no more
// evidence, so the reported reason named the wrong cause.
function convincedThrough(assessment: Judgment): Judgment[] {
  return [
    judgment({ hypothesis: "unknown" }),
    judgment({ assessment: "insufficient", next_evidence: "database_state" }),
    judgment({ hypothesis: "suspected_violation" }),
    judgment({ assessment: "insufficient", next_evidence: "operation_contract" }),
    judgment({ hypothesis: "suspected_violation" }),
    assessment,
  ];
}

test("an unconvinced critic holding complete evidence is not reported as missing evidence", async () => {
  const evidence = source();
  const result = await investigate(evidence, scripted(
    convincedThrough(judgment({ assessment: "supported", next_evidence: "none" }, 0.65)),
  ));
  assert.equal(result.verdict, "insufficient");
  assert.deepEqual(result.evidenceIds, ["database_state", "operation_contract"]);
  assert.equal(result.reason, "critic_unconvinced");
});

test("a refuting critic holding complete evidence is reported as unconvinced", async () => {
  const result = await investigate(source(), scripted(
    convincedThrough(judgment({ assessment: "refuted", next_evidence: "none" })),
  ));
  assert.equal(result.verdict, "insufficient");
  assert.equal(result.reason, "critic_unconvinced");
});

test("a critic asking for nothing before the required evidence still reports incomplete evidence", async () => {
  const result = await investigate(source(), scripted([
    judgment({ hypothesis: "suspected_violation" }),
    judgment({ assessment: "insufficient", next_evidence: "none" }),
  ]));
  assert.equal(result.verdict, "insufficient");
  assert.equal(result.reason, "incomplete_evidence");
});

test("a critic reselecting already retrieved evidence is reported as an invalid choice", async () => {
  const result = await investigate(source(), scripted([
    judgment({ hypothesis: "unknown" }),
    judgment({ assessment: "insufficient", next_evidence: "database_state" }),
    judgment({ hypothesis: "unknown" }),
    judgment({ assessment: "insufficient", next_evidence: "database_state" }),
  ]));
  assert.equal(result.verdict, "insufficient");
  assert.equal(result.reason, "invalid_evidence_choice");
});

// A second application declares its own catalog and its own mandatory readings.
// The engine must gate on what the source requires, not on Linkding's keys.
test("the mandatory evidence set comes from the source rather than the engine", async () => {
  const evidence = source();
  evidence.required = ["operation_contract"];
  const result = await investigate(evidence, scripted([
    judgment({ hypothesis: "suspected_violation" }),
    judgment({ assessment: "insufficient", next_evidence: "operation_contract" }),
    judgment({ hypothesis: "suspected_violation" }),
    judgment({ assessment: "supported", next_evidence: "none" }),
    judgment({ verdict: "regression", grounding: "sufficient" }),
  ]));
  assert.equal(result.verdict, "regression");
  assert.deepEqual(result.evidenceIds, ["operation_contract"]);
});

test("a source demanding evidence it cannot supply is rejected", async () => {
  const evidence = source();
  evidence.required = ["database_state", "nonexistent_source"];
  await assert.rejects(investigate(evidence, scripted([])), /Invalid investigation limits|required evidence/i);
});

test("the state offered to each role names the source's own requirements", async () => {
  const evidence = source();
  evidence.required = ["known_good_run"];
  const states: Json[] = [];
  await investigate(evidence, scripted([judgment({ hypothesis: "unknown" })], states));
  const first = states[0];
  assert.ok(first && typeof first === "object" && !Array.isArray(first));
  assert.deepEqual(first.requiredEvidence, ["known_good_run"]);
});
