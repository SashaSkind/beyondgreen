import type { ChoiceAnswer, ChoiceQuestion, Judgment } from "./types.ts";

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
  throw new Error("Model returned an invalid response");
}

export function parseJudgment(
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

