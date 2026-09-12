import type { Verdict } from "./investigation/types.ts";
import { estimateCostUsd, type ProviderRate } from "./cost.ts";

type Row = { expected: "clean" | "regression"; verdict: Verdict; latencyMs: number; usage: { inputTokens: number; outputTokens: number } };
export function summarizeEvaluation(rows: readonly Row[], rate?: ProviderRate) {
  const confusion = { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0, abstainedRegression: 0, abstainedClean: 0 };
  const usage = { inputTokens: 0, outputTokens: 0 };
  for (const row of rows) {
    const positive = row.expected === "regression";
    if (row.verdict === "insufficient") confusion[positive ? "abstainedRegression" : "abstainedClean"]++;
    else if (row.verdict === "regression") confusion[positive ? "truePositive" : "falsePositive"]++;
    else confusion[positive ? "falseNegative" : "trueNegative"]++;
    usage.inputTokens += row.usage.inputTokens;
    usage.outputTokens += row.usage.outputTokens;
  }
  const ratio = (a: number, b: number) => b ? a / b : null;
  const estimated = estimateCostUsd(usage, rate);
  const { truePositive: tp, falsePositive: fp, trueNegative: tn, falseNegative: fn, abstainedRegression: ar, abstainedClean: ac } = confusion;
  return {
    total: rows.length, correct: tp + tn, confusion,
    accuracyAll: ratio(tp + tn, rows.length), coverage: ratio(tp + fp + tn + fn, rows.length),
    regressionRecallAll: ratio(tp, tp + fn + ar), precision: ratio(tp, tp + fp),
    falsePositiveRateAll: ratio(fp, fp + tn + ac), abstentionRate: ratio(ar + ac, rows.length),
    meanLatencyMs: ratio(rows.reduce((total, row) => total + row.latencyMs, 0), rows.length),
    usage,
    // Estimated from a rate the provider published, over parsed responses only.
    estimatedCostUsd: estimated,
    estimatedCostPerInvestigationUsd: estimated === null ? null : ratio(estimated, rows.length),
    rateSource: rate?.source ?? null,
    // Billed cost is never available to this harness.
    costUsd: null,
  };
}
