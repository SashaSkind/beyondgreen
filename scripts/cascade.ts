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
import { readdir, readFile, stat } from "node:fs/promises";

// Pick the newest completed capture set, so a demo command needs no path.
async function newestSuite(): Promise<string> {
  const root = resolve(".scratch/suites");
  const candidates: { path: string; time: number }[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name, "suite.json");
    try {
      if (JSON.parse(await readFile(path, "utf8")).complete !== true) continue;
      candidates.push({ path, time: (await stat(path)).mtimeMs });
    } catch { continue; }
  }
  if (!candidates.length) throw new Error("no complete suite found under .scratch/suites");
  return candidates.sort((a, b) => a.time - b.time).at(-1)!.path;
}

// Weave prices the providers that publish no rate we can cite.
async function weaveCostUsd(client: Awaited<ReturnType<typeof weave.init>>, callIds: string[]): Promise<number | null> {
  let total = 0, priced = 0;
  for (const callId of callIds) {
    const children = await client.getCalls({ filter: { parent_ids: [callId] }, includeCosts: true });
    for (const child of children) {
      const costs = (child as { summary?: { weave?: { costs?: Record<string, { prompt_tokens_total_cost?: number; completion_tokens_total_cost?: number }> } } }).summary?.weave?.costs;
      for (const entry of Object.values(costs ?? {})) {
        const amount = (entry.prompt_tokens_total_cost ?? 0) + (entry.completion_tokens_total_cost ?? 0);
        if (amount > 0) { total += amount; priced++; }
      }
    }
  }
  return priced ? total : null;
}

type Row = Cascade & { caseId: string; expected: "clean" | "regression"; verdict: Verdict; latencyMs: number; usage: { inputTokens: number; outputTokens: number } };

async function main() {
  const { values } = parseArgs({ options: {
    suite: { type: "string" },
    policy: { type: "string", default: "cascade" },
    escalateOn: { type: "string", default: "insufficient" },
  } });
  const policy = values.policy;
  if (!["typesafe", "deepseek", "cascade"].includes(policy)) throw new Error("usage");
  // Three terminals should each be one short command, so the suite is found
  // rather than typed. The newest complete capture wins.
  const suitePath = values.suite ? resolve(values.suite) : await newestSuite();
  const escalateOn = values.escalateOn.split(",") as Verdict[];
  if (escalateOn.some((v) => !["insufficient", "regression", "clean"].includes(v))) throw new Error("usage");

  const suite = await loadBenchmarkSuite(suitePath);
  const judges = { typesafe: createTypeSafeJudge(), deepseek: createDeepSeekJudge() };
  const project = process.env.WEAVE_PROJECT?.trim() || "beyond-green";
  if (!process.env.WANDB_API_KEY?.trim()) throw new Error("credentials");
  const client = await weave.init(project);

  const cascadeId = randomUUID();
  const directory = resolve(".scratch/cascades", cascadeId);
  await mkdir(directory, { recursive: true });

  const tierNames: ("typesafe" | "deepseek")[] = policy === "cascade" ? ["typesafe", "deepseek"] : [policy as "typesafe" | "deepseek"];
  const dataset = new weave.Dataset({
    name: `${policy}-${suite.sha256.slice(0, 12)}`,
    rows: suite.cases.map((row, index) => ({ sampleId: String(index), caseId: row.id, expected: row.expected })),
  });
  await dataset.save();
  const logger = new weave.EvaluationLogger({
    name: `${policy}-${cascadeId.slice(0, 8)}`,
    dataset,
    model: { name: tierNames.join(" then ") },
    attributes: { cascadeId, policy, escalateOn, suiteSha256: suite.sha256, tiers: tierNames },
  });

  const rows: Row[] = [];
  const callIds: { tier: string; callId: string }[] = [];
  console.log(`${policy.toUpperCase()} over ${suite.cases.length} cases` +
    (policy === "cascade" ? `, escalating on ${escalateOn.join(", ")}` : "") + `.\n`);

  for (const [index, sample] of suite.cases.entries()) {
    await suite.assertUnchanged();
    const tiers = tierNames.map((tier) => ({
      tier,
      run: async () => {
        const source = await loadLinkdingEvidence(sample.currentDir, sample.baselineDir);
        const traced = createTracedInvestigation(source, judges[tier]);
        const [result, call] = await traced.invoke(randomUUID());
        callIds.push({ tier, callId: call.id });
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
    policy, summary: full, typesafeEstimatedCostUsd: cheapCost,
    costNote: "Published rates where a provider states one; Weave default-rate estimates otherwise. Parsed responses only.",
    rows,
  }, null, 2) + "\n");

  // Price it. A provider with a published rate is arithmetic; one without is
  // whatever Weave estimated for the calls this run actually made.
  await client.flush();
  const perTier: string[] = [];
  let runCost = 0;
  let complete = true;
  for (const tier of tierNames) {
    const usage = rows.flatMap((r) => r.attempts).filter((a) => a.tier === tier)
      .reduce((t, a) => ({ inputTokens: t.inputTokens + a.usage.inputTokens, outputTokens: t.outputTokens + a.usage.outputTokens }), { inputTokens: 0, outputTokens: 0 });
    const calls = callIds.filter((c) => c.tier === tier).map((c) => c.callId);
    const published = estimateCostUsd(usage, PUBLISHED_RATES[tier]);
    const cost = published ?? await weaveCostUsd(client, calls);
    if (cost === null) complete = false; else runCost += cost;
    perTier.push(`  ${tier.padEnd(10)} ${calls.length.toString().padStart(3)} investigations  ` +
      `${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out  ` +
      `${cost === null ? "cost unavailable" : "$" + cost.toFixed(5)}` +
      `${published !== null ? "  (published rate)" : cost !== null ? "  (Weave estimate)" : ""}`);
  }
  const perInvestigation = complete ? runCost / rows.length : null;

  console.log(`\ncorrect ${summary.correct}/${summary.total}` +
    (policy === "cascade" ? `   escalated ${escalated}/${rows.length}   flipped ${flipped}` : "") +
    `   mean ${((summary.meanLatencyMs ?? 0) / 1000).toFixed(1)}s`);
  console.log(`\n${"─".repeat(72)}`);
  console.log(`  POLICY: ${policy}`);
  perTier.forEach((line) => console.log(line));
  console.log(`${"─".repeat(72)}`);
  if (perInvestigation === null) {
    console.log(`  TOTAL   cost unavailable for at least one tier`);
  } else {
    console.log(`  TOTAL   $${runCost.toFixed(5)} for ${rows.length} investigations` +
      `   =  $${perInvestigation.toFixed(5)} each   →   $${(perInvestigation * 250).toFixed(2)} per 250 tests`);
  }
  console.log(`${"─".repeat(72)}`);
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
