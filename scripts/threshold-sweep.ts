// Measure what the acceptance threshold is worth, by re-running the whole suite
// at several values instead of reasoning about stored probabilities.
//
// A receipt cannot answer this on its own. Lowering the bar changes which round
// the loop stops in, so a run that abstained never produced the Verifier answer
// a lower bar would have reached. The only honest sweep re-runs the loop, which
// costs about two cents on the cheap provider.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import * as weave from "weave";
import { loadBenchmarkSuite } from "../src/benchmark-suite.ts";
import { summarizeEvaluation } from "../src/evaluation.ts";
import { loadLinkdingEvidence } from "../src/investigation/evidence.ts";
import { createTypeSafeJudge } from "../src/investigation/typesafe.ts";
import { createDeepSeekJudge } from "../src/investigation/deepseek.ts";
import { investigate } from "../src/investigation/engine.ts";
import type { Verdict } from "../src/investigation/types.ts";
import { PUBLISHED_RATES, estimateCostUsd } from "../src/cost.ts";

type Row = { threshold: number; caseId: string; expected: "clean" | "regression"; verdict: Verdict; reason: string; latencyMs: number; usage: { inputTokens: number; outputTokens: number } };

async function main() {
  const { values } = parseArgs({ options: {
    suite: { type: "string" }, provider: { type: "string", default: "typesafe" },
    thresholds: { type: "string", default: "0.3,0.4,0.5,0.6,0.7,0.8,0.9" },
  } });
  if (!values.suite) throw new Error("usage");
  const thresholds = values.thresholds.split(",").map(Number);
  if (!thresholds.length || thresholds.some((t) => !Number.isFinite(t) || t < 0 || t > 1)) throw new Error("usage");
  if (!["typesafe", "deepseek"].includes(values.provider)) throw new Error("usage");

  const suite = await loadBenchmarkSuite(resolve(values.suite));
  const judge = values.provider === "typesafe" ? createTypeSafeJudge() : createDeepSeekJudge();
  const project = process.env.WEAVE_PROJECT?.trim() || "beyond-green";
  if (!process.env.WANDB_API_KEY?.trim()) throw new Error("credentials");
  const client = await weave.init(project);

  const sweepId = randomUUID();
  const directory = resolve(".scratch/sweeps", sweepId);
  await mkdir(directory, { recursive: true });
  const rows: Row[] = [];

  const dataset = new weave.Dataset({
    name: `threshold-sweep-${suite.sha256.slice(0, 12)}`,
    rows: suite.cases.map((row, index) => ({ sampleId: String(index), caseId: row.id, expected: row.expected })),
  });
  await dataset.save();

  console.log(`Sweeping ${thresholds.length} thresholds over ${suite.cases.length} cases with ${values.provider}.\n`);

  for (const threshold of thresholds) {
    const logger = new weave.EvaluationLogger({
      name: `threshold-${threshold}-${sweepId.slice(0, 8)}`,
      dataset,
      model: { name: `${values.provider} @ minConfidence ${threshold}` },
      attributes: { sweepId, provider: values.provider, threshold, suiteSha256: suite.sha256 },
    });
    for (const [index, sample] of suite.cases.entries()) {
      await suite.assertUnchanged();
      const source = await loadLinkdingEvidence(sample.currentDir, sample.baselineDir);
      const result = await investigate(source, judge, { minConfidence: threshold });
      rows.push({ threshold, caseId: sample.id, expected: sample.expected, verdict: result.verdict,
        reason: result.reason, latencyMs: result.latencyMs, usage: result.usage });
      const prediction = await logger.logPredictionAsync({ sampleId: String(index), threshold },
        { verdict: result.verdict, reason: result.reason });
      await prediction.logScore("correct", result.verdict === sample.expected);
      await prediction.logScore("abstained", result.verdict === "insufficient");
      await prediction.finish();
    }
    const summary = summarizeEvaluation(rows.filter((r) => r.threshold === threshold), PUBLISHED_RATES[values.provider]);
    await logger.logSummary(summary);
    const wrong = summary.confusion.falsePositive + summary.confusion.falseNegative;
    console.log(`minConfidence ${threshold.toFixed(2)}  correct ${summary.correct}/${summary.total}` +
      `  abstained ${summary.confusion.abstainedRegression + summary.confusion.abstainedClean}` +
      `  wrong ${wrong}  falsePositives ${summary.confusion.falsePositive}`);
  }

  const totalUsage = rows.reduce((t, r) => ({ inputTokens: t.inputTokens + r.usage.inputTokens, outputTokens: t.outputTokens + r.usage.outputTokens }), { inputTokens: 0, outputTokens: 0 });
  const spend = estimateCostUsd(totalUsage, PUBLISHED_RATES[values.provider]);
  const reportPath = join(directory, "sweep.json");
  await writeFile(reportPath, JSON.stringify({
    sweepId, suiteSha256: suite.sha256, provider: values.provider, thresholds, complete: true,
    investigations: rows.length, estimatedCostUsd: spend, rows,
  }, null, 2) + "\n");
  await client.flush();

  console.log(`\n${rows.length} investigations, ${spend === null ? "cost unavailable" : `about $${spend.toFixed(4)}`}.`);
  console.log(`Receipt: ${reportPath}`);
  console.log(`Weave: https://wandb.ai/${client.projectId}/weave/evaluations`);
  console.log("\nOne number gates three checks: the Critic's assessment, the Verifier's verdict, and its grounding.");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error && error.message === "usage"
    ? "Usage: npm run sweep -- --suite <suite.json> [--provider typesafe|deepseek] [--thresholds 0.3,0.5,0.8]"
    : "Sweep stopped. Check suite integrity, credentials, and provider connectivity.");
  process.exitCode = 1;
}
