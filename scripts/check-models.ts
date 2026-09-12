// Connectivity probe only. These synthetic answers are not benchmark results.
import { mkdir, writeFile } from "node:fs/promises";

const state = {
  claim: "The payment failed.",
  evidence: "Payment p-001 succeeded and its database status is paid.",
};
const criteria = {
  supports: "The evidence supports the claim.",
  contradicts: "The evidence contradicts the claim.",
  insufficient: "The evidence does not establish whether the claim is true.",
};

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Unexpected response structure");
  }
  return value as Record<string, unknown>;
}

async function probe(provider: string, url: string, keyName: string, body: object, headers: Record<string, string> = {}) {
  const key = process.env[keyName]?.trim();
  if (!key) return { provider, ok: false, error: `${keyName} is not configured` };
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      // Never print raw HTTP errors or authorization headers.
      return { provider, ok: false, httpStatus: response.status };
    }
    const data = record(await response.json());
    let answer: unknown;
    if (provider === "typesafe") {
      const relation = record(record(data.answers).relation);
      if (relation.type !== "choice") throw new Error("Unexpected answer type");
      answer = relation.choice;
    } else {
      if (!Array.isArray(data.choices)) throw new Error("Missing choices");
      const first = record(data.choices[0]);
      if (first.finish_reason !== "stop") throw new Error("Incomplete completion");
      const content = record(first.message).content;
      if (typeof content !== "string") throw new Error("Missing content");
      answer = record(JSON.parse(content)).relation;
    }
    if (typeof answer !== "string" || !Object.hasOwn(criteria, answer)) {
      throw new Error("Unexpected relation");
    }
    return {
      provider, ok: true, model: data.model, answer,
      expectedAnswer: "contradicts", matchesExpected: answer === "contradicts",
      latencyMs: Math.round(performance.now() - started), usage: data.usage,
    };
  } catch {
    return { provider, ok: false, error: "Network, timeout, or invalid response" };
  }
}

const results = await Promise.all([
  probe("typesafe", "https://api.typesafe.ai/v1/systemone", "TYPESAFE_API_KEY", {
    model: process.env.TYPESAFE_MODEL || "jev-latest",
    state,
    questions: {
      relation: { type: "choice", instructions: "How does the evidence relate to the claim?", criteria },
    },
  }),
  probe("wandb-inference", "https://api.inference.wandb.ai/v1/chat/completions", "WANDB_API_KEY", {
    model: process.env.WANDB_INFERENCE_MODEL || "deepseek-ai/DeepSeek-V4-Pro-0813",
    messages: [
      { role: "system", content: `Judge how evidence relates to a claim. Relation definitions: ${JSON.stringify(criteria)}. Return JSON with a relation field.` },
      { role: "user", content: JSON.stringify(state) },
    ],
    max_tokens: 128,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "evidence_relation", strict: true,
        schema: {
          type: "object",
          properties: { relation: { type: "string", enum: Object.keys(criteria) } },
          required: ["relation"], additionalProperties: false,
        },
      },
    },
  }, process.env.WANDB_INFERENCE_PROJECT
    ? { "OpenAI-Project": process.env.WANDB_INFERENCE_PROJECT }
    : {}),
]);

const receipt = { checkedAt: new Date().toISOString(), purpose: "synthetic connectivity check", results };
await mkdir(".scratch", { recursive: true });
await writeFile(".scratch/model-connectivity.json", JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt, null, 2));
if (results.some(result => !result.ok || !result.matchesExpected)) process.exitCode = 1;
