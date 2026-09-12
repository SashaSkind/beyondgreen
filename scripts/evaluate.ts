import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import * as weave from "weave";
import { loadBenchmarkSuite } from "../src/benchmark-suite.ts";
import { summarizeEvaluation } from "../src/evaluation.ts";
import { loadLinkdingEvidence } from "../src/investigation/evidence.ts";
import { createTypeSafeJudge } from "../src/investigation/typesafe.ts";
import { createDeepSeekJudge, DEEPSEEK_SETTINGS } from "../src/investigation/deepseek.ts";
import { createTracedInvestigation, verifyInvestigationTrace } from "../src/investigation/tracing.ts";
import type { Investigation } from "../src/investigation/engine.ts";

type Provider = "typesafe" | "deepseek";
type Row = Investigation & { caseId: string; expected: "clean" | "regression"; provider: Provider; repeat: number; investigationId: string; traceUrl: string; traceVerified: boolean; verifiedChildCalls: number };

async function main() {
  const { values } = parseArgs({ options: {
    suite: { type: "string" }, repeats: { type: "string", default: "1" }, provider: { type: "string", default: "both" },
  } });
  const repeats = Number(values.repeats);
  if (!values.suite || !Number.isInteger(repeats) || repeats < 1 || repeats > 10 || !["typesafe", "deepseek", "both"].includes(values.provider)) throw new Error("usage");
  const suite = await loadBenchmarkSuite(resolve(values.suite));
  const providers: Provider[] = values.provider === "both" ? ["typesafe", "deepseek"] : [values.provider as Provider];
  const judges = Object.fromEntries(providers.map((provider) => [provider, provider === "typesafe" ? createTypeSafeJudge() : createDeepSeekJudge()]));
  const project = process.env.WEAVE_PROJECT?.trim() || "beyond-green";
  if (!process.env.WANDB_API_KEY?.trim() || !/^[\w-]+(?:\/[\w-]+)?$/.test(project)) throw new Error("configuration");
  const client = await weave.init(project);
  const evaluationId = randomUUID();
  const directory = resolve(".scratch/evaluations", evaluationId);
  await mkdir(directory, { recursive: true });
  const rows: Row[] = [];
  const codeFiles = ["src/investigation/engine.ts", "src/investigation/evidence.ts", "src/investigation/typesafe.ts", "src/investigation/deepseek.ts", "src/investigation/choice-response.ts", "scripts/evaluate.ts"];
  const codeHashes = Object.fromEntries(await Promise.all(codeFiles.map(async (path) => [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
  const configuration = {
    repeats, providers, minConfidence: 0.8, maxRounds: 4, retries: 0,
    typesafeModel: process.env.TYPESAFE_MODEL || "jev-1.13.0",
    deepseekModel: process.env.WANDB_INFERENCE_MODEL || "deepseek-ai/DeepSeek-V4-Pro-0813",
    deepseekReasoning: DEEPSEEK_SETTINGS.reasoning, deepseekMaxTokens: DEEPSEEK_SETTINGS.maxTokens,
    deepseekTimeoutMs: DEEPSEEK_SETTINGS.timeoutMs,
    confidenceSemantics: { typesafe: "native distribution concentration", deepseek: "self-reported estimate; not calibrated or directly comparable" },
    usageScope: "Successful parsed responses only; failed requests may incur unreported usage.",
  };
  const reportPath = join(directory, "evaluation.json");
  async function save(complete: boolean) {
    await writeFile(reportPath, JSON.stringify({
      evaluationId, suiteSha256: suite.sha256, codeHashes, configuration, complete, rows,
      summaries: Object.fromEntries(providers.map((provider) => [provider, summarizeEvaluation(rows.filter((row) => row.provider === provider))])),
    }, null, 2) + "\n");
  }
  await save(false);
  console.log(`Evaluation receipt: ${reportPath}`);
  const dataset = new weave.Dataset({ name: `linkding-${suite.sha256.slice(0, 12)}`, rows: suite.cases.map((row, index) => ({ sampleId: String(index), caseId: row.id, expected: row.expected })) });
  await dataset.save();
  const loggers = Object.fromEntries(providers.map((provider) => [provider, new weave.EvaluationLogger({
    name: `linkding-${provider}-${evaluationId.slice(0, 8)}`, dataset,
    model: { name: provider === "typesafe" ? configuration.typesafeModel : configuration.deepseekModel },
    attributes: { evaluationId, provider, suiteSha256: suite.sha256, configuration },
  })]));
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (const [index, sample] of suite.cases.entries()) {
      // Alternate provider order to avoid always warming the same provider first.
      const order = (index + repeat) % 2 ? [...providers].reverse() : providers;
      for (const provider of order) {
        await suite.assertUnchanged();
        console.log(`Investigating sample ${index + 1}/${suite.cases.length}, ${provider}, repeat ${repeat + 1}`);
        const source = await loadLinkdingEvidence(sample.currentDir, sample.baselineDir);
        const run = createTracedInvestigation(source, judges[provider], (message) => console.log(`  ${message}`));
        const id = randomUUID();
        const [result, call] = await run.invoke(id);
        const row: Row = { ...result, caseId: sample.id, expected: sample.expected, provider, repeat: repeat + 1,
          investigationId: id, traceUrl: `https://wandb.ai/${client.projectId}/r/call/${call.id}`, traceVerified: false, verifiedChildCalls: 0 };
        rows.push(row);
        await save(false);
        await suite.assertUnchanged();
        row.verifiedChildCalls = await verifyInvestigationTrace(client, call.id, id, result);
        row.traceVerified = true;
        // Ground truth is used only after the investigation returns, for scoring.
        const prediction = await loggers[provider].logPredictionAsync({ sampleId: String(index), repeat: repeat + 1 }, {
          verdict: row.verdict, reason: row.reason, investigationTrace: row.traceUrl,
          latencyMs: row.latencyMs, usage: row.usage,
        });
        await prediction.logScore("correct", row.verdict === sample.expected);
        await prediction.logScore("abstained", row.verdict === "insufficient");
        await prediction.finish();
        await save(false);
        console.log(`${provider}: ${row.verdict} (${row.reason}), ${(row.latencyMs / 1000).toFixed(2)}s; expected ${sample.expected}`);
      }
    }
  }
  for (const provider of providers) {
    const summary = summarizeEvaluation(rows.filter((row) => row.provider === provider));
    await loggers[provider].logSummary(summary);
    console.log(`${provider} summary: ${JSON.stringify(summary)}`);
  }
  await client.flush();
  // Verify Evaluation.evaluate roots as well as all individual investigation traces.
  const roots = await client.getCalls({ filter: { trace_roots_only: true }, limit: 100 });
  const evaluationRoots = roots.filter((call) => call.attributes?.evaluationId === evaluationId && call.op_name.includes("Evaluation.evaluate"));
  if (evaluationRoots.length !== providers.length || evaluationRoots.some((call) => !call.ended_at || call.exception)) throw new Error("evaluation_trace");
  await save(true);
  console.log(`Weave evaluations: https://wandb.ai/${client.projectId}/weave/evaluations`);
  console.log(`Completed evaluation: ${reportPath}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error && error.message === "usage"
    ? "Usage: npm run evaluate -- --suite <suite.json> [--repeats 1-10] [--provider typesafe|deepseek|both]"
    : "Evaluation stopped. Partial receipts are retained. Check suite integrity, credentials, provider responses, and Weave connectivity.");
  process.exitCode = 1;
}
