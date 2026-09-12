import type { ChoiceAnswer, ChoiceQuestion, Judge, Judgment } from "./types.ts";

type TypeSafeOptions = {
  apiKey?: string;
  model?: string;
  fetch?: typeof globalThis.fetch;
};

const probabilityTolerance = 0.001;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function invalidResponse(): never {
  throw new Error("TypeSafe returned an invalid response");
}

function parseJudgment(
  value: unknown,
  questions: Record<string, ChoiceQuestion>,
  latencyMs: number,
): Judgment {
  if (
    !isRecord(value) || typeof value.model !== "string" || !value.model.trim() ||
    !isRecord(value.answers) || !hasExactKeys(value.answers, Object.keys(questions)) ||
    !isRecord(value.usage) || !isTokenCount(value.usage.input_tokens) ||
    !isTokenCount(value.usage.output_tokens)
  ) {
    return invalidResponse();
  }

  const entries: [string, ChoiceAnswer][] = [];
  for (const [id, question] of Object.entries(questions)) {
    const answer = value.answers[id];
    const options = Object.keys(question.criteria);
    if (
      !isRecord(answer) || answer.type !== "choice" || typeof answer.choice !== "string" ||
      !options.includes(answer.choice) || !isProbability(answer.confidence) ||
      !isRecord(answer.probabilities) || !hasExactKeys(answer.probabilities, options)
    ) {
      return invalidResponse();
    }
    const probabilities: [string, number][] = [];
    for (const option of options) {
      const probability = answer.probabilities[option];
      if (!isProbability(probability)) return invalidResponse();
      probabilities.push([option, probability]);
    }
    const distribution = Object.fromEntries(probabilities);
    const selectedProbability = distribution[answer.choice];
    const total = probabilities.reduce((sum, [, probability]) => sum + probability, 0);
    if (
      Math.abs(total - 1) > probabilityTolerance ||
      probabilities.some(([, probability]) => probability > selectedProbability + probabilityTolerance)
    ) {
      return invalidResponse();
    }
    entries.push([id, {
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: distribution,
    }]);
  }

  return {
    model: value.model,
    answers: Object.fromEntries(entries),
    usage: { inputTokens: value.usage.input_tokens, outputTokens: value.usage.output_tokens },
    latencyMs,
  };
}

export function createTypeSafeJudge(options: TypeSafeOptions = {}): Judge {
  const apiKey = (options.apiKey ?? process.env.TYPESAFE_API_KEY)?.trim();
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is required");
  const model = options.model || process.env.TYPESAFE_MODEL || "jev-1.13.0";
  const fetch = options.fetch ?? globalThis.fetch;

  return async (state, questions) => {
    const started = performance.now();
    const signal = AbortSignal.timeout(30_000);
    let response: Response;
    try {
      response = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, state, questions }),
        signal,
      });
    } catch {
      throw new Error(signal.aborted ? "TypeSafe request timed out" : "TypeSafe request failed");
    }
    if (!response.ok) throw new Error(`TypeSafe request failed (HTTP ${response.status})`);
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      if (signal.aborted) throw new Error("TypeSafe request timed out");
      return invalidResponse();
    }
    return parseJudgment(value, questions, performance.now() - started);
  };
}
