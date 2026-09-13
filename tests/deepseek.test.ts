import assert from "node:assert/strict";
import test from "node:test";
import { createDeepSeekJudge, resolveMaxTokens } from "../src/investigation/deepseek.ts";
import type { ChoiceQuestion } from "../src/investigation/types.ts";

const questions: Record<string, ChoiceQuestion> = {
  verdict: { type: "choice", instructions: "Does evidence violate the requirement?", criteria: {
    violation: "The evidence contradicts the requirement", consistent: "The evidence agrees",
  } },
};
const answer = { choice: "violation", confidence: 0.8, probabilities: { violation: 0.9, consistent: 0.1 } };
function completion(content: unknown = { answers: { verdict: answer } }) {
  return {
    model: "actual-deepseek-model",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 150, completion_tokens: 80 },
  };
}

test("DeepSeek sends the shared questions with a strict dynamic schema and maps model usage", async () => {
  const state = { test: "passed", evidence: ["missing record"] };
  const judge = createDeepSeekJudge({
    apiKey: "test-key", project: "test-team/test-project", model: "requested-model",
    fetch: async (url, init) => {
      assert.equal(url, "https://api.inference.wandb.ai/v1/chat/completions");
      assert.equal(init?.method, "POST");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer test-key");
      assert.equal(headers.get("openai-project"), "test-team/test-project");
      assert.equal(headers.get("content-type"), "application/json");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "requested-model");
      assert.equal(body.max_tokens, 8192);
      assert.deepEqual(body.chat_template_kwargs, { enable_thinking: true });
      assert.deepEqual(JSON.parse(body.messages[1].content), { state, questions });
      assert.match(body.messages[0].content, /self-reported/);
      const format = body.response_format;
      assert.equal(format.type, "json_schema");
      assert.equal(format.json_schema.strict, true);
      const schema = format.json_schema.schema;
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required, ["answers"]);
      const answersSchema = schema.properties.answers;
      assert.deepEqual(answersSchema.required, ["verdict"]);
      assert.equal(answersSchema.additionalProperties, false);
      assert.deepEqual(answersSchema.properties.verdict.properties.choice.enum, ["violation", "consistent"]);
      assert.deepEqual(answersSchema.properties.verdict.properties.probabilities.required, ["violation", "consistent"]);
      assert.ok(init?.signal instanceof AbortSignal);
      return Response.json(completion());
    },
  });
  const result = await judge(state, questions);
  assert.equal(result.model, "actual-deepseek-model");
  assert.deepEqual(result.answers, { verdict: answer });
  assert.deepEqual(result.usage, { inputTokens: 150, outputTokens: 80 });
  assert.ok(Number.isFinite(result.latencyMs) && result.latencyMs >= 0);
});

test("DeepSeek rejects truncated and malformed completions rather than grading them", async () => {
  const truncated = completion();
  truncated.choices[0].finish_reason = "length";
  const invalidProbability = completion({ answers: { verdict: { ...answer, probabilities: { violation: 0.4, consistent: 0.1 } } } });
  const extraAnswer = completion({ answers: { verdict: answer, leaked: answer } });
  const missingUsage = { ...completion(), usage: {} };
  for (const payload of [invalidProbability, extraAnswer, missingUsage]) {
    const judge = createDeepSeekJudge({ apiKey: "test", project: "team/project", fetch: async () => Response.json(payload) });
    await assert.rejects(judge({}, questions), /^Error: DeepSeek returned an invalid or incomplete response$/);
  }
  const judge = createDeepSeekJudge({ apiKey: "test", project: "team/project", fetch: async () => Response.json(truncated) });
  await assert.rejects(judge({}, questions), /^Error: DeepSeek response exceeded token budget$/);
});

test("DeepSeek sanitizes failures and never retries", async () => {
  let calls = 0;
  const judge = createDeepSeekJudge({ apiKey: "secret-test-key", project: "team/project", fetch: async () => {
    calls++;
    return new Response("secret-test-key private payload", { status: 401 });
  } });
  await assert.rejects(judge({}, questions), /^Error: DeepSeek request failed \(HTTP 401\)$/);
  assert.equal(calls, 1);
  const transport = createDeepSeekJudge({ apiKey: "test", project: "team/project", fetch: async () => { throw new Error("secret-test-key"); } });
  await assert.rejects(transport({}, questions), /^Error: DeepSeek request failed$/);
  assert.throws(() => createDeepSeekJudge({ apiKey: "", project: "team/project" }), /WANDB_API_KEY/);
  assert.throws(() => createDeepSeekJudge({ apiKey: "test", project: "" }), /WANDB_INFERENCE_PROJECT/);
});

test("the response budget defaults to 8192 and rejects unusable overrides", () => {
  assert.equal(resolveMaxTokens(undefined), 8192);
  assert.equal(resolveMaxTokens(""), 8192);
  assert.equal(resolveMaxTokens("16384"), 16384);
  for (const bad of ["0", "512", "abc", "8192.5", "99999999"]) {
    assert.throws(() => resolveMaxTokens(bad), /WANDB_INFERENCE_MAX_TOKENS/);
  }
});
