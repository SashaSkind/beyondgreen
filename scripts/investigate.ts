import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import * as weave from "weave";
import { createTracedInvestigation, verifyInvestigationTrace } from "../src/investigation/tracing.ts";
import { loadLinkdingEvidence } from "../src/investigation/evidence.ts";
import { createTypeSafeJudge } from "../src/investigation/typesafe.ts";
import { createDeepSeekJudge } from "../src/investigation/deepseek.ts";

async function main() {
  const { values } = parseArgs({ options: { run: { type: "string" }, baseline: { type: "string" }, provider: { type: "string", default: "typesafe" } } });
  if (!values.run || !values.baseline) throw new Error("usage");
  if (!process.env.WANDB_API_KEY?.trim()) throw new Error("credentials");
  const project = process.env.WEAVE_PROJECT?.trim() || "beyond-green";
  if (!/^[\w-]+(?:\/[\w-]+)?$/.test(project)) throw new Error("project");
  const source = await loadLinkdingEvidence(resolve(values.run), resolve(values.baseline));
  if (!["typesafe", "deepseek"].includes(values.provider)) throw new Error("usage");
  const baseJudge = values.provider === "typesafe" ? createTypeSafeJudge() : createDeepSeekJudge();
  const client = await weave.init(project);
  const run = createTracedInvestigation(source, baseJudge, console.log);

  const id = randomUUID();
  const directory = resolve(".scratch/investigations", id);
  await mkdir(directory, { recursive: true });
  const [result, call] = await run.invoke(id);
  const traceUrl = `https://wandb.ai/${client.projectId}/r/call/${call.id}`;
  const receipt = { ...result, traceUrl, traceVerified: false, verifiedChildCalls: 0 };
  const outputPath = join(directory, "investigation.json");
  await writeFile(outputPath, JSON.stringify(receipt, null, 2) + "\n");
  console.log(`Verdict: ${result.verdict} (${result.reason}; ${result.scope})`);
  console.log(`Usage: ${result.usage.inputTokens} input / ${result.usage.outputTokens} output tokens; ${(result.latencyMs / 1000).toFixed(2)}s; cost unavailable`);
  console.log(`Receipt: ${outputPath}`);
  receipt.verifiedChildCalls = await verifyInvestigationTrace(client, call.id, id, result);
  receipt.traceVerified = true;
  await writeFile(outputPath, JSON.stringify(receipt, null, 2) + "\n");
  console.log(`Verified Weave trace (${receipt.verifiedChildCalls} child steps): ${traceUrl}`);
  process.exitCode = result.verdict === "insufficient" ? 2 : 0;
}

const timeout = setTimeout(() => {
  console.error("Investigation timed out. Check the local receipt and provider connectivity.");
  process.exit(1);
}, 660_000);
timeout.unref();
try {
  await main();
} catch (error) {
  const kind = error instanceof Error ? error.message : "unknown";
  console.error(kind === "usage"
    ? "Usage: npm run investigate -- --run <capture-directory> --baseline <known-good-directory> [--provider typesafe|deepseek]"
    : kind === "trace"
      ? "Investigation saved locally, but the Weave trace could not be verified."
      : "Investigation failed. Check artifact validity, provider credentials, project access, and connectivity.");
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
