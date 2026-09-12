import { setTimeout as delay } from "node:timers/promises";
import * as weave from "weave";
import { investigate } from "./engine.ts";
import type { Investigation } from "./engine.ts";
import type { EvidenceKey, EvidenceSource, Judge, Judgment } from "./types.ts";

export function createTracedInvestigation(source: EvidenceSource, baseJudge: Judge, log: (message: string) => void = () => {}) {
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
    log(`${state.role}: ${Object.entries(result.answers).map(([key, answer]) => `${key}=${answer.choice} (${answer.confidence.toFixed(3)})`).join(", ")}`);
    return result;
  };
  const retrieve = weave.op(async (key: EvidenceKey) => {
    const evidence = await source.retrieve(key);
    log(`Evidence: ${key}`);
    return evidence;
  }, { name: "Evidence", opKind: "tool" });
  // Paths, case IDs, expected labels, and provider credentials stay in closures.
  return weave.op(async (investigationId: string) => ({
    investigationId, ...await investigate({ ...source, retrieve }, judge),
  }), { name: "Investigation", opKind: "agent" });
}

export async function verifyInvestigationTrace(client: Awaited<ReturnType<typeof weave.init>>, callId: string, id: string, result: Investigation) {
  await client.flush();
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await delay(1000);
    const [calls, children] = await Promise.all([
      client.getCalls({ filter: { call_ids: [callId] } }),
      client.getCalls({ filter: { parent_ids: [callId] } }),
    ]);
    const saved = calls[0];
    const output: unknown = saved?.output;
    if (saved?.ended_at && !saved.exception && output && typeof output === "object" &&
        "investigationId" in output && output.investigationId === id &&
        children.length >= result.steps.length + result.evidenceIds.length &&
        children.every((child) => child.ended_at && (result.verdict === "insufficient" || !child.exception))) {
      return children.length;
    }
  }
  throw new Error("trace");
}
