export type ProviderRate = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  source: string;
};

// Rates published by the provider to the account running this benchmark. A
// provider absent from this table has no rate we can cite, so its cost stays
// unavailable rather than being reported as zero. DeepSeek is deliberately
// absent: its figures come from Weave's default-rate estimates, which are an
// estimate made by a third party rather than a rate the provider published.
export const PUBLISHED_RATES: Record<string, ProviderRate> = {
  typesafe: {
    inputUsdPerMillionTokens: 0.042,
    outputUsdPerMillionTokens: 0,
    source: "TypeSafe usage dashboard, read 2026-09-12: $0.042 per million input tokens, output not billed.",
  },
};

// Rates for models this harness has never run. They exist only to project what
// the same loop would cost elsewhere, and a projection is not a measurement.
export const REFERENCE_RATES: Record<string, ProviderRate> = {
  "claude-fable-5-1": {
    inputUsdPerMillionTokens: 10,
    outputUsdPerMillionTokens: 50,
    source: "Anthropic published API rates, read 2026-09-13.",
  },
  "gpt-6-astra": {
    inputUsdPerMillionTokens: 10,
    outputUsdPerMillionTokens: 50,
    source: "OpenAI published API rates, read 2026-09-13.",
  },
  "gpt-6-astra-batch": {
    inputUsdPerMillionTokens: 5,
    outputUsdPerMillionTokens: 25,
    source: "OpenAI batch and flex tier, half the standard rate, read 2026-09-13.",
  },
};

// Estimated from recorded token counts, so it undercounts whenever a request
// consumed tokens without producing a parsed judgment.
export function estimateCostUsd(
  usage: { inputTokens: number; outputTokens: number },
  rate: ProviderRate | undefined,
): number | null {
  if (!rate) return null;
  const counts = [usage.inputTokens, usage.outputTokens];
  const prices = [rate.inputUsdPerMillionTokens, rate.outputUsdPerMillionTokens];
  if (!counts.every((count) => Number.isSafeInteger(count) && count >= 0)) throw new Error("Invalid token usage");
  if (!prices.every((price) => Number.isFinite(price) && price >= 0)) throw new Error("Invalid provider rate");
  return (usage.inputTokens * prices[0] + usage.outputTokens * prices[1]) / 1_000_000;
}
