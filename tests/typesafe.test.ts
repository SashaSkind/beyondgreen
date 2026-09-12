import assert from "node:assert/strict";
import test from "node:test";

import { createTypeSafeJudge } from "../src/investigation/typesafe.ts";
import type { ChoiceQuestion } from "../src/investigation/types.ts";

const questions: Record<string, ChoiceQuestion> = {
  verdict: {
    type: "choice",
    instructions: "Does the evidence show a violation?",
    criteria: { violation: "Evidence contradicts the requirement", consistent: "Evidence matches" },
  },
};

function validResponse() {
  return {
    model: "jev-1.13.0",
    answers: {
      verdict: {
        type: "choice",
        choice: "violation",
        confidence: 0.7,
        probabilities: { violation: 0.9, consistent: 0.1 },
      },
    },
    usage: { input_tokens: 320, output_tokens: 40 },
  };
}

test("TypeSafe serializes typed questions and maps the actual response model and usage", async () => {
  const state = { test: "passed", evidence: ["row absent"] };
  let calls = 0;
  const judge = createTypeSafeJudge({
    apiKey: "test-key",
    model: "requested-model-alias",
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, "https://api.typesafe.ai/v1/systemone");
      assert.equal(init?.method, "POST");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer test-key");
      assert.equal(headers.get("content-type"), "application/json");
      assert.deepEqual(JSON.parse(String(init?.body)), { model: "requested-model-alias", state, questions });
      assert.ok(init?.signal instanceof AbortSignal);
      assert.equal(init.signal.aborted, false);
      return Response.json(validResponse());
    },
  });
  const result = await judge(state, questions);
  assert.equal(calls, 1);
  assert.equal(result.model, "jev-1.13.0");
  assert.deepEqual(result.answers.verdict, {
    choice: "violation", confidence: 0.7, probabilities: { violation: 0.9, consistent: 0.1 },
  });
  assert.deepEqual(result.usage, { inputTokens: 320, outputTokens: 40 });
  assert.ok(Number.isFinite(result.latencyMs) && result.latencyMs >= 0);
});

test("TypeSafe rejects a missing key before making a request", () => {
  assert.throws(() => createTypeSafeJudge({ apiKey: " " }), { message: "TYPESAFE_API_KEY is required" });
});

test("TypeSafe HTTP errors expose only status and are not retried", async () => {
  let calls = 0;
  const judge = createTypeSafeJudge({
    apiKey: "test-secret",
    fetch: async () => {
      calls++;
      return new Response("echoed test-secret and private evidence", { status: 401 });
    },
  });
  await assert.rejects(judge("private evidence", questions), { message: "TypeSafe request failed (HTTP 401)" });
  assert.equal(calls, 1);
});

test("TypeSafe sanitizes transport and JSON decoding failures", async () => {
  const failingFetch: typeof fetch = async () => { throw new Error("test-secret and private evidence"); };
  await assert.rejects(
    createTypeSafeJudge({ apiKey: "test-secret", fetch: failingFetch })(null, questions),
    { message: "TypeSafe request failed" },
  );
  await assert.rejects(
    createTypeSafeJudge({ apiKey: "test-secret", fetch: async () => new Response("private evidence") })(null, questions),
    { message: "TypeSafe returned an invalid response" },
  );
});

const malformedResponses: [string, () => unknown][] = [
  ["missing answer", () => ({ ...validResponse(), answers: {} })],
  ["extra answer", () => ({ ...validResponse(), answers: { ...validResponse().answers, extra: {} } })],
  ["wrong answer type", () => {
    const value = validResponse(); value.answers.verdict.type = "noul"; return value;
  }],
  ["unknown choice", () => {
    const value = validResponse(); value.answers.verdict.choice = "private evidence"; return value;
  }],
  ["choice contradicts distribution", () => {
    const value = validResponse(); value.answers.verdict.choice = "consistent"; return value;
  }],
  ["missing probability", () => ({ ...validResponse(), answers: {
    verdict: { ...validResponse().answers.verdict, probabilities: { violation: 1 } },
  } })],
  ["extra probability", () => ({ ...validResponse(), answers: {
    verdict: { ...validResponse().answers.verdict, probabilities: { violation: 0.9, consistent: 0.1, extra: 0 } },
  } })],
  ["probabilities do not sum to one", () => {
    const value = validResponse(); value.answers.verdict.probabilities.violation = 0.7; return value;
  }],
  ["negative probability", () => {
    const value = validResponse(); value.answers.verdict.probabilities.consistent = -0.1; return value;
  }],
  ["nonfinite probability", () => {
    const value = validResponse(); value.answers.verdict.probabilities.violation = Infinity; return value;
  }],
  ["confidence out of range", () => {
    const value = validResponse(); value.answers.verdict.confidence = 2; return value;
  }],
  ["fractional token count", () => {
    const value = validResponse(); value.usage.input_tokens = 1.5; return value;
  }],
  ["negative token count", () => {
    const value = validResponse(); value.usage.output_tokens = -1; return value;
  }],
  ["missing model", () => ({ ...validResponse(), model: "" })],
];

for (const [description, response] of malformedResponses) {
  test(`TypeSafe rejects ${description}`, async () => {
    const judge = createTypeSafeJudge({ apiKey: "test-key", fetch: async () => Response.json(response()) });
    await assert.rejects(judge(null, questions), { message: "TypeSafe returned an invalid response" });
  });
}

test("TypeSafe accepts normal probability rounding error", async () => {
  const response = validResponse();
  response.answers.verdict.probabilities.consistent = 0.099999;
  const judge = createTypeSafeJudge({ apiKey: "test-key", fetch: async () => Response.json(response) });
  assert.equal((await judge(null, questions)).answers.verdict.choice, "violation");
});

// Live sampling of jev-1.13.0 returned probabilities rounded to two decimals, so
// a well-formed distribution can sum to 0.99 or 1.01. These are verbatim bodies
// from three rejected responses observed across 62 sampled answers.
const scoutQuestions: Record<string, ChoiceQuestion> = {
  hypothesis: {
    type: "choice",
    instructions: "Assess the observed operation.",
    criteria: { consistent: "Satisfies the contract", suspected_violation: "Violates the contract", unknown: "Cannot establish" },
  },
};

function roundedResponse(probabilities: Record<string, number>, choice: string) {
  return {
    model: "jev-1.13.0",
    answers: { hypothesis: { type: "choice", choice, confidence: 0.33, probabilities } },
    usage: { input_tokens: 491, output_tokens: 38 },
  };
}

test("TypeSafe accepts a three-option two-decimal distribution summing to 0.99", async () => {
  const response = roundedResponse({ unknown: 0.55, suspected_violation: 0.27, consistent: 0.17 }, "unknown");
  const judge = createTypeSafeJudge({ apiKey: "test-key", fetch: async () => Response.json(response) });
  const judgment = await judge(null, scoutQuestions);
  assert.equal(judgment.answers.hypothesis.choice, "unknown");
  assert.equal(judgment.answers.hypothesis.probabilities.unknown, 0.55);
});

test("TypeSafe accepts a two-decimal distribution summing to 1.01", async () => {
  const response = roundedResponse({ unknown: 0.56, suspected_violation: 0.28, consistent: 0.17 }, "unknown");
  const judge = createTypeSafeJudge({ apiKey: "test-key", fetch: async () => Response.json(response) });
  assert.equal((await judge(null, scoutQuestions)).answers.hypothesis.choice, "unknown");
});

test("TypeSafe accepts a four-option two-decimal distribution summing to 0.99", async () => {
  const evidenceQuestions: Record<string, ChoiceQuestion> = {
    next_evidence: {
      type: "choice",
      instructions: "Choose the most useful missing evidence.",
      criteria: { database_state: "Snapshots", known_good_run: "Reference run", operation_contract: "Contract", none: "Nothing needed" },
    },
  };
  const response = {
    model: "jev-1.13.0",
    answers: {
      next_evidence: {
        type: "choice",
        choice: "database_state",
        confidence: 0.39,
        probabilities: { database_state: 0.54, known_good_run: 0.05, operation_contract: 0.28, none: 0.12 },
      },
    },
    usage: { input_tokens: 602, output_tokens: 81 },
  };
  const judge = createTypeSafeJudge({ apiKey: "test-key", fetch: async () => Response.json(response) });
  assert.equal((await judge(null, evidenceQuestions)).answers.next_evidence.choice, "database_state");
});

test("TypeSafe accepts a choice one rounding unit below the reported maximum", async () => {
  const response = roundedResponse({ unknown: 0.44, suspected_violation: 0.45, consistent: 0.11 }, "unknown");
  const judge = createTypeSafeJudge({ apiKey: "test-key", fetch: async () => Response.json(response) });
  assert.equal((await judge(null, scoutQuestions)).answers.hypothesis.choice, "unknown");
});

test("TypeSafe still rejects a distribution too far from one to be rounding", async () => {
  const response = roundedResponse({ unknown: 0.55, suspected_violation: 0.15, consistent: 0.1 }, "unknown");
  const judge = createTypeSafeJudge({ apiKey: "test-key", fetch: async () => Response.json(response) });
  await assert.rejects(judge(null, scoutQuestions), { message: "TypeSafe returned an invalid response" });
});

test("TypeSafe still rejects a choice far below the reported maximum", async () => {
  const response = roundedResponse({ unknown: 0.2, suspected_violation: 0.7, consistent: 0.1 }, "unknown");
  const judge = createTypeSafeJudge({ apiKey: "test-key", fetch: async () => Response.json(response) });
  await assert.rejects(judge(null, scoutQuestions), { message: "TypeSafe returned an invalid response" });
});
