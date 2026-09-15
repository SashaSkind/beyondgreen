// Two things about the providers that only show up in the raw answers, plus the
// aggregate record the single-case visualisation cannot show.
//
// Both findings are measured here rather than asserted, so anyone can re-run
// this against the receipts and get the same numbers. Output feeds site/findings.html.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { normalizedConfidence } from "../src/investigation/choice-response.ts";

const { values } = parseArgs({
  options: {
    dir: { type: "string", default: ".scratch/cascades" },
    gate: { type: "string", default: "0.8" },
    out: { type: "string", default: "site/findings-data.js" },
  },
});
const GATE = Number(values.gate);

type Answer = { choice: string; confidence: number; probabilities: Record<string, number> };
type Step = { role: string; judgment: { model: string; answers: Record<string, Answer> } };
type Row = {
  caseId: string; expected: string; verdict: string; escalations: number;
  totalLatencyMs: number; final: { reason: string; steps: Step[] };
};
type Report = {
  policy?: string; escalateOn?: string[]; rows?: Row[];
  summary?: {
    total: number; correct: number; meanLatencyMs: number;
    confusion: Record<string, number>;
  };
};

const reports: Report[] = [];
for (const entry of await readdir(values.dir!)) {
  const path = join(values.dir!, entry, "cascade.json");
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Report;
    if (parsed.policy && parsed.rows && parsed.summary) reports.push(parsed);
  } catch { /* not a completed cascade receipt */ }
}
if (!reports.length) throw new Error(`No completed cascade receipts under ${values.dir}`);

function family(model: string): string {
  return model.startsWith("jev") ? model : "deepseek";
}

// ---- finding one: distributions that do not sum to one ---------------------
// A two-decimal distribution can legitimately miss 1.00, which a strict
// tolerance reads as a malformed response. Record how often, and which way.
type SumStat = { model: string; answers: number; sums: Record<string, number>; examples: unknown[] };
const sums = new Map<string, SumStat>();

// ---- finding two: what "confidence" means to each provider -----------------
// One reports the top probability; the other reports how far that probability
// sits above chance. The same gate is therefore not the same bar.
type FormulaStat = { model: string; answers: number; marginOnly: number; pmaxOnly: number; both: number; neither: number };
const formula = new Map<string, FormulaStat>();

// ---- the gate, re-scored on a common scale ---------------------------------
// Every confidence the gate ever looked at, asked twice: as the provider
// reported it, and as the top probability. A single disagreement would mean the
// recorded paths are not what a common scale would have produced.
let evaluations = 0, flips = 0;
const flipDetail: unknown[] = [];

const near = (a: number, b: number) => Math.abs(a - b) <= 0.011;

for (const report of reports) {
  for (const row of report.rows!) {
    for (const step of row.final.steps) {
      const model = family(step.judgment.model);
      for (const [question, answer] of Object.entries(step.judgment.answers)) {
        const probs = Object.values(answer.probabilities);
        const pmax = Math.max(...probs);
        const total = Number(probs.reduce((a, b) => a + b, 0).toFixed(6));

        const s = sums.get(model) ?? { model, answers: 0, sums: {}, examples: [] };
        s.answers += 1;
        s.sums[total.toFixed(2)] = (s.sums[total.toFixed(2)] ?? 0) + 1;
        if (total !== 1 && s.examples.length < 6) {
          s.examples.push({ model: step.judgment.model, role: step.role, question, total, probabilities: answer.probabilities });
        }
        sums.set(model, s);

        const f = formula.get(model) ?? { model, answers: 0, marginOnly: 0, pmaxOnly: 0, both: 0, neither: 0 };
        const isMargin = near(answer.confidence, normalizedConfidence(answer.probabilities));
        const isPmax = near(answer.confidence, pmax);
        f.answers += 1;
        if (isMargin && isPmax) f.both += 1;
        else if (isMargin) f.marginOnly += 1;
        else if (isPmax) f.pmaxOnly += 1;
        else f.neither += 1;
        formula.set(model, f);

        // The gate reads a Critic's assessment and both Verifier answers.
        const gated = (step.role === "Critic" && question === "assessment") || step.role === "Verifier";
        if (!gated) continue;
        evaluations += 1;
        const asReported = answer.confidence >= GATE;
        const asPmax = pmax >= GATE;
        if (asReported !== asPmax) {
          flips += 1;
          if (flipDetail.length < 12) {
            flipDetail.push({
              caseId: row.caseId, model: step.judgment.model, role: step.role, question,
              choice: answer.choice, reported: answer.confidence, pmax,
            });
          }
        }
      }
    }
  }
}

// ---- where an abstention actually sat ---------------------------------------
// For every run that gave up because the Critic was never convinced, the last
// supported assessment it made: the number the gate rejected, and what the same
// answer looks like on the other scale. This is the only place the choice of
// scale could have changed an outcome, so it is worth showing case by case.
type Boundary = {
  policy: string; caseId: string; model: string;
  reported: number; pmax: number; passesReported: boolean; passesPmax: boolean;
};
const boundaries: Boundary[] = [];
for (const report of reports) {
  for (const row of report.rows!) {
    if (row.final.reason !== "critic_unconvinced") continue;
    const supported = row.final.steps
      .filter((s) => s.role === "Critic" && s.judgment.answers.assessment?.choice === "supported")
      .pop();
    if (!supported) continue;
    const a = supported.judgment.answers.assessment;
    const pmax = Math.max(...Object.values(a.probabilities));
    boundaries.push({
      policy: report.policy!, caseId: row.caseId, model: supported.judgment.model,
      reported: a.confidence, pmax,
      passesReported: a.confidence >= GATE, passesPmax: pmax >= GATE,
    });
  }
}

// ---- the aggregate record, across every repeat of every policy -------------
type PolicyStat = {
  policy: string; runs: number; total: number; correct: string;
  falsePositive: number; falseNegative: number; abstained: number;
  latencySeconds: [number, number]; accuracy: string;
};
const byPolicy = new Map<string, { runs: Report[] }>();
for (const r of reports) {
  const e = byPolicy.get(r.policy!) ?? { runs: [] };
  e.runs.push(r);
  byPolicy.set(r.policy!, e);
}

const policies: PolicyStat[] = [...byPolicy].map(([policy, { runs }]) => {
  const correct = [...new Set(runs.map((r) => r.summary!.correct))].sort((a, b) => a - b);
  const latencies = runs.map((r) => r.summary!.meanLatencyMs / 1000);
  const c = runs.map((r) => r.summary!.confusion);
  return {
    policy,
    runs: runs.length,
    total: runs[0].summary!.total,
    // A range where repeats disagreed, one number where they did not.
    correct: correct.length === 1 ? String(correct[0]) : `${correct[0]}–${correct[correct.length - 1]}`,
    accuracy: correct.length === 1 ? "identical across every repeat" : "varied between repeats",
    falsePositive: Math.max(...c.map((x) => x.falsePositive)),
    falseNegative: Math.max(...c.map((x) => x.falseNegative)),
    abstained: Math.max(...c.map((x) => x.abstainedRegression + x.abstainedClean)),
    latencySeconds: [Math.min(...latencies), Math.max(...latencies)] as [number, number],
  };
}).sort((a, b) => a.policy.localeCompare(b.policy));

const data = {
  generatedFrom: reports.length,
  gate: GATE,
  sums: [...sums.values()].sort((a, b) => a.model.localeCompare(b.model)),
  formula: [...formula.values()].sort((a, b) => a.model.localeCompare(b.model)),
  rescore: { evaluations, flips, detail: flipDetail },
  boundaries,
  policies,
};

await writeFile(values.out!, `// Generated by scripts/provider-report.ts. Do not edit by hand.\nwindow.FINDINGS = ${JSON.stringify(data, null, 1)};\n`);

console.log(`Read ${reports.length} cascade receipts.`);
for (const s of data.sums) {
  const off = Object.entries(s.sums).filter(([k]) => k !== "1.00");
  console.log(`  ${s.model}: ${s.answers} answers, sums ${JSON.stringify(s.sums)}`
    + (off.length ? `  <- ${off.reduce((n, [, v]) => n + v, 0)} not 1.00` : ""));
}
for (const f of data.formula) {
  console.log(`  ${f.model}: margin-only ${f.marginOnly}, pmax-only ${f.pmaxOnly}, both ${f.both}, neither ${f.neither}`);
}
console.log(`  gate re-score: ${flips} of ${evaluations} decisions differ on a common scale`);
const wouldPass = boundaries.filter((b) => !b.passesReported && b.passesPmax).length;
console.log(`  abstentions at the boundary: ${wouldPass} of ${boundaries.length} would clear a top-probability gate`);
for (const p of policies) {
  console.log(`  ${p.policy}: ${p.runs} runs, ${p.correct}/${p.total} correct, FP ${p.falsePositive}, FN ${p.falseNegative},`
    + ` ${p.latencySeconds[0].toFixed(1)}–${p.latencySeconds[1].toFixed(1)}s`);
}
console.log(`Wrote ${values.out}`);
