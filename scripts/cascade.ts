// Run the suite as a cascade: the cheap provider first, escalating only what it
// refuses to answer. Logs `escalated` and `flipped` alongside the existing
// scores, so the policy is measured per run rather than replayed by hand.
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
import { createTracedInvestigation } from "../src/investigation/tracing.ts";
import { escalate, type Cascade } from "../src/investigation/cascade.ts";
import { PUBLISHED_RATES, estimateCostUsd } from "../src/cost.ts";
import type { Verdict } from "../src/investigation/types.ts";

type Row = Cascade & { caseId: string; expected: "clean" | "regression"; verdict: Verdict; latencyMs: number; usage: { inputTokens: number; outputTokens: number } };

async function main() {
  const { values } = parseArgs({ options: {
    suite: { type: "string" },
    escalateOn: { type: "string", default: "insufficient" },
  } });
  if (!values.suite) throw new Error("usage");
  const escalateOn = values.escalateOn.split(",") as Verdict[];
  if (escalateOn.some((v) => !["insufficient", "regression", "clean"].includes(v))) throw new Error("usage");

  const suite = await loadBenchmarkSuite(resolve(values.suite));
  const judges = { typesafe: createTypeSafeJudge(), deepseek: createDeepSeekJudge() };
  const project = process.env.WEAVE_PROJECT?.trim() || "beyond-green";
  if (!process.env.WANDB_API_KEY?.trim()) throw new Error("credentials");
  const client = await weave.init(project);

  const cascadeId = randomUUID();
  const directory = resolve(".scratch/cascades", cascadeId);
  await mkdir(directory, { recursive: true });

  const dataset = new weave.Dataset({
    name: `cascade-${suite.sha256.slice(0, 12)}`,
    rows: suite.cases.map((row, index) => ({ sampleId: String(index), caseId: row.id, expected: row.expected })),
  });
  await dataset.save();
  const logger = new weave.EvaluationLogger({
    name: `cascade-${cascadeId.slice(0, 8)}`,
    dataset,
    model: { name: "typesafe then deepseek" },
    attributes: { cascadeId, escalateOn, suiteSha256: suite.sha256, tiers: ["typesafe", "deepseek"] },
  });

  const rows: Row[] = [];
  console.log(`Cascade over ${suite.cases.length} cases, escalating on ${escalateOn.join(", ")}.\n`);

  for (const [index, sample] of suite.cases.entries()) {
    await suite.assertUnchanged();
    const tiers = (["typesafe", "deepseek"] as const).map((tier) => ({
      tier,
      run: async () => {
        const source = await loadLinkdingEvidence(sample.currentDir, sample.baselineDir);
        const traced = createTracedInvestigation(source, judges[tier]);
        const [result] = await traced.invoke(randomUUID());
        return result;
      },
    }));
    const result = await escalate(tiers, { escalateOn });
    const row: Row = { ...result, caseId: sample.id, expected: sample.expected,
      verdict: result.final.verdict, latencyMs: result.totalLatencyMs, usage: result.totalUsage };
    rows.push(row);

    const prediction = await logger.logPredictionAsync({ sampleId: String(index) }, {
      verdict: row.verdict, finalTier: result.finalTier,
      attempts: result.attempts.map((a) => `${a.tier}:${a.verdict}`),
    });
    await prediction.logScore("correct", row.verdict === sample.expected);
    await prediction.logScore("abstained", row.verdict === "insufficient");
    await prediction.logScore("escalated", result.escalations > 0);
    await prediction.logScore("flipped", result.flipped);
    await prediction.finish();

    console.log(`${sample.id.padEnd(28)} ${row.verdict.padEnd(13)} via ${result.finalTier.padEnd(9)}` +
      ` ${result.escalations ? "escalated" : "         "} ${result.flipped ? "flipped" : ""}`);
  }

  const summary = summarizeEvaluation(rows);
  const escalated = rows.filter((r) => r.escalations > 0).length;
  const flipped = rows.filter((r) => r.flipped).length;
  const cheapUsage = rows.flatMap((r) => r.attempts).filter((a) => a.tier === "typesafe")
    .reduce((t, a) => ({ inputTokens: t.inputTokens + a.usage.inputTokens, outputTokens: t.outputTokens + a.usage.outputTokens }), { inputTokens: 0, outputTokens: 0 });
  const cheapCost = estimateCostUsd(cheapUsage, PUBLISHED_RATES.typesafe);
  const full = { ...summary, escalationRate: escalated / rows.length, flipRate: flipped / rows.length };
  await logger.logSummary(full);
  await client.flush();

  const reportPath = join(directory, "cascade.json");
  await writeFile(reportPath, JSON.stringify({
    cascadeId, suiteSha256: suite.sha256, escalateOn, complete: true,
    summary: full, typesafeEstimatedCostUsd: cheapCost,
    deepseekCostNote: "No provider rate available; Weave default-rate estimates cover the escalated calls only.",
    rows,
  }, null, 2) + "\n");

  console.log(`\ncorrect ${summary.correct}/${summary.total}   escalated ${escalated}/${rows.length}   flipped ${flipped}`);
  console.log(`cheap tier cost ${cheapCost === null ? "unavailable" : `$${cheapCost.toFixed(5)}`} for ${rows.length} investigations, plus ${escalated} escalated calls.`);
  console.log(`Receipt: ${reportPath}`);
  console.log(`Weave: https://wandb.ai/${client.projectId}/weave/evaluations`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error && error.message === "usage"
    ? "Usage: npm run cascade -- --suite <suite.json> [--escalateOn insufficient,regression]"
    : "Cascade stopped. Check suite integrity, credentials, and provider connectivity.");
  process.exitCode = 1;
}
