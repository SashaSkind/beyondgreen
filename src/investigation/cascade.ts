import type { Investigation } from "./engine.ts";
import type { Verdict } from "./types.ts";

export type Tier = { tier: string; run: () => Promise<Investigation> };

export type Attempt = {
  tier: string;
  verdict: Verdict;
  reason: string;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number };
};

export type Cascade = {
  final: Investigation;
  finalTier: string;
  escalations: number;
  // True when a later tier reached a different verdict from the first. A
  // recovered abstention and a contradicted finding both count, and both are
  // worth reviewing for opposite reasons.
  flipped: boolean;
  attempts: Attempt[];
  totalLatencyMs: number;
  totalUsage: { inputTokens: number; outputTokens: number };
};

// Run tiers in order, cheapest first, stopping at the first verdict the policy
// accepts. A tier that is never reached is never billed.
export async function escalate(
  tiers: readonly Tier[],
  options: { escalateOn?: readonly Verdict[] } = {},
): Promise<Cascade> {
  if (!tiers.length) throw new Error("A cascade needs at least one tier");
  const escalateOn = options.escalateOn ?? ["insufficient"];

  const attempts: Attempt[] = [];
  let final: Investigation | null = null;
  let finalTier = "";

  for (const { tier, run } of tiers) {
    const result = await run();
    attempts.push({
      tier, verdict: result.verdict, reason: result.reason,
      latencyMs: result.latencyMs, usage: result.usage,
    });
    final = result;
    finalTier = tier;
    if (!escalateOn.includes(result.verdict)) break;
  }

  const settled = final!;
  return {
    final: settled,
    finalTier,
    escalations: attempts.length - 1,
    flipped: settled.verdict !== attempts[0].verdict,
    attempts,
    totalLatencyMs: attempts.reduce((total, a) => total + a.latencyMs, 0),
    totalUsage: {
      inputTokens: attempts.reduce((total, a) => total + a.usage.inputTokens, 0),
      outputTokens: attempts.reduce((total, a) => total + a.usage.outputTokens, 0),
    },
  };
}
