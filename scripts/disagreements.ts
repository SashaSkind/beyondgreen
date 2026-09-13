// Collect every case where two providers reached different verdicts on the same
// capture, and publish them as a Weave Dataset.
//
// The point is that nobody labelled this set. Disagreement between tiers is
// visible without ground truth, which is what makes it usable in production
// where labels do not exist. Expected verdicts are attached here only because
// this benchmark happens to have them, and they are not what selects a row.
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import * as weave from "weave";

type Row = { caseId: string; provider: string; verdict: string; reason: string; expected: string };
type Study = { evaluationId: string; rows: Row[] };

function studies(value: unknown): Study[] {
  if (!value || typeof value !== "object") throw new Error("results");
  const list = (value as { studies?: unknown }).studies;
  if (!Array.isArray(list)) throw new Error("results");
  return list as Study[];
}

const { values } = parseArgs({ options: {
  results: { type: "string", default: "docs/experiments/linkding-comparison-results.json" },
  publish: { type: "boolean", default: false },
} });

const record = JSON.parse(await readFile(values.results, "utf8"));
const disagreements: Record<string, unknown>[] = [];
let compared = 0;

for (const study of studies(record)) {
  const byCase = new Map<string, Row[]>();
  for (const row of study.rows ?? []) {
    byCase.set(row.caseId, [...(byCase.get(row.caseId) ?? []), row]);
  }
  for (const [caseId, rows] of byCase) {
    if (rows.length < 2) continue;
    compared++;
    const verdicts = new Set(rows.map((r) => r.verdict));
    if (verdicts.size === 1) continue;
    disagreements.push({
      study: study.evaluationId.slice(0, 8),
      caseId,
      expected: rows[0].expected,
      tiers: rows.map((r) => ({ provider: r.provider, verdict: r.verdict, reason: r.reason })),
      // Which kind of disagreement this is decides what it is evidence of.
      kind: verdicts.has("insufficient") && verdicts.size === 2 ? "one_abstained" : "contradiction",
      anyCorrect: rows.some((r) => r.verdict === r.expected),
      allCorrect: rows.every((r) => r.verdict === r.expected),
    });
  }
}

console.log(`${compared} cases compared across ${studies(record).length} studies.`);
console.log(`${disagreements.length} disagreements found.\n`);
for (const row of disagreements) {
  const tiers = (row.tiers as { provider: string; verdict: string; reason: string }[])
    .map((t) => `${t.provider}=${t.verdict}${t.verdict === "insufficient" ? ` (${t.reason})` : ""}`).join("  ");
  console.log(`  ${String(row.study)}  ${String(row.caseId).padEnd(28)} ${String(row.kind).padEnd(14)} ${tiers}`);
}

const abstained = disagreements.filter((r) => r.kind === "one_abstained").length;
const contradictions = disagreements.length - abstained;
console.log(`\n${abstained} where one tier gave up, ${contradictions} where they contradicted each other.`);
console.log("The first kind is what a cascade recovers. The second is what needs a human.");

if (values.publish) {
  if (!process.env.WANDB_API_KEY?.trim()) throw new Error("WANDB_API_KEY is required to publish");
  const client = await weave.init(process.env.WEAVE_PROJECT?.trim() || "beyond-green");
  const dataset = new weave.Dataset({
    name: "tier-disagreements",
    rows: disagreements.map((row, index) => ({ sampleId: String(index), ...row })),
  });
  await dataset.save();
  await client.flush();
  console.log(`\nPublished ${disagreements.length} rows as the "tier-disagreements" dataset.`);
}
