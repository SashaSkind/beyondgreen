import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import * as weave from "weave";
import { investigate } from "../src/investigation/engine.ts";
import { loadLinkdingEvidence } from "../src/investigation/evidence.ts";
import { createTypeSafeJudge } from "../src/investigation/typesafe.ts";
import type { EvidenceKey, Judge, Judgment } from "../src/investigation/types.ts";

async function main() {
  const { values } = parseArgs({ options: { run: { type: "string" }, baseline: { type: "string" } } });
  if (!values.run || !values.baseline) throw new Error("usage");
  if (!process.env.WANDB_API_KEY?.trim()) throw new Error("credentials");
  const project = process.env.WEAVE_PROJECT?.trim() || "beyond-green";
  if (!/^[\w-]+(?:\/[\w-]+)?$/.test(project)) throw new Error("project");
  const source = await loadLinkdingEvidence(resolve(values.run), resolve(values.baseline));
  const baseJudge = createTypeSafeJudge();
  const client = await weave.init(project);
  function summarize(result: Judgment) {
    return { usage: { [result.model]: {
      prompt_tokens: result.usage.inputTokens, completion_tokens: result.usage.outputTokens,
      total_tokens: result.usage.inputTokens + result.usage.outputTokens,
    } } };
  }
  const roles = Object.fromEntries(["Scout", "Critic", "Investigator", "Verifier"].map((role) => [
    role, weave.op(baseJudge, { name: role, opKind: "llm", summarize }),
  ]));
  const judge: Judge = async (state, questions) => {
    if (!state || typeof state !== "object" || Array.isArray(state) || typeof state.role !== "string" || !roles[state.role]) {
      throw new Error("Unknown investigation role");
    }
    const result = await roles[state.role](state, questions);
    console.log(`${state.role}: ${Object.entries(result.answers).map(([key, answer]) => `${key}=${answer.choice} (${answer.confidence.toFixed(3)})`).join(", ")}`);
    return result;
  };
  const retrieve = weave.op(async (key: EvidenceKey) => {
    const evidence = await source.retrieve(key);
    console.log(`Evidence: ${key}`);
    return evidence;
  }, { name: "Evidence", opKind: "tool" });
  const run = weave.op(async (investigationId: string) => ({
    investigationId,
    ...await investigate({ ...source, retrieve }, judge),
  }), { name: "Investigation", opKind: "agent" });

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
  await client.flush();
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await delay(1000);
    const [calls, children] = await Promise.all([
      client.getCalls({ filter: { call_ids: [call.id] } }),
      client.getCalls({ filter: { parent_ids: [call.id] } }),
    ]);
    const saved = calls[0];
    const output: unknown = saved?.output;
    if (saved?.ended_at && !saved.exception && output && typeof output === "object" &&
        "investigationId" in output && output.investigationId === id &&
        children.length >= result.steps.length + result.evidenceIds.length &&
        children.every((child) => child.ended_at && (result.verdict === "insufficient" || !child.exception))) {
      receipt.traceVerified = true;
      receipt.verifiedChildCalls = children.length;
      await writeFile(outputPath, JSON.stringify(receipt, null, 2) + "\n");
      console.log(`Verified Weave trace (${children.length} child steps): ${traceUrl}`);
      process.exitCode = result.verdict === "insufficient" ? 2 : 0;
      return;
    }
  }
  throw new Error("trace");
}

const timeout = setTimeout(() => {
  console.error("Investigation timed out. Check the local receipt and provider connectivity.");
  process.exit(1);
}, 360_000);
timeout.unref();
try {
  await main();
} catch (error) {
  const kind = error instanceof Error ? error.message : "unknown";
  console.error(kind === "usage"
    ? "Usage: npm run investigate -- --run <capture-directory> --baseline <known-good-directory>"
    : kind === "trace"
      ? "Investigation saved locally, but the Weave trace could not be verified."
      : "Investigation failed. Check artifact validity, provider credentials, project access, and connectivity.");
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
