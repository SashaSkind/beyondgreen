import type { Judge } from "./types.ts";
import { parseJudgment } from "./choice-response.ts";

type TypeSafeOptions = {
  apiKey?: string;
  model?: string;
  fetch?: typeof globalThis.fetch;
};

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
      throw new Error("TypeSafe returned an invalid response");
    }
    try {
      return parseJudgment(value, questions, performance.now() - started);
    } catch {
      throw new Error("TypeSafe returned an invalid response");
    }
  };
}
