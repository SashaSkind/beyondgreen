// Project what this loop would cost on models the harness has never run, using
// the token profile it actually measured. A projection is not a measurement, so
// the output labels every row as one or the other.
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { estimateCostUsd, PUBLISHED_RATES, REFERENCE_RATES, type ProviderRate } from "../src/cost.ts";

type Profile = { name: string; inputTokens: number; outputTokens: number; runs: number };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("receipt");
  return value as Record<string, unknown>;
}

// Average the per-investigation token counts a provider used across every
// completed study, so one unusually long run cannot set the projection.
async function profiles(paths: string[]): Promise<Profile[]> {
  const totals = new Map<string, { input: number; output: number; runs: number }>();
  for (const path of paths) {
    const report = record(JSON.parse(await readFile(path, "utf8")));
    if (report.complete !== true) throw new Error(`${path} is not a completed evaluation`);
    for (const row of report.rows as { provider: string; usage: { inputTokens: number; outputTokens: number } }[]) {
      const entry = totals.get(row.provider) ?? { input: 0, output: 0, runs: 0 };
      entry.input += row.usage.inputTokens;
      entry.output += row.usage.outputTokens;
      entry.runs += 1;
      totals.set(row.provider, entry);
    }
  }
  return [...totals].map(([name, t]) => ({
    name, runs: t.runs,
    inputTokens: Math.round(t.input / t.runs),
    outputTokens: Math.round(t.output / t.runs),
  })).sort((a, b) => a.outputTokens - b.outputTokens);
}

function money(value: number): string {
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(5)}`;
}

function line(label: string, rate: ProviderRate, profile: Profile, tests: number, measured: boolean) {
  const per = estimateCostUsd({ inputTokens: profile.inputTokens, outputTokens: profile.outputTokens }, rate);
  if (per === null) return;
  console.log(
    `${measured ? "measured " : "projected"}  ${label.padEnd(22)} ${money(per).padStart(10)} ` +
    `${money(per * tests).padStart(10)}   ${profile.inputTokens.toLocaleString()} in / ${profile.outputTokens.toLocaleString()} out`,
  );
}

const { values, positionals } = parseArgs({ options: { tests: { type: "string", default: "250" } }, allowPositionals: true });
const tests = Number(values.tests);
if (!positionals.length || !Number.isSafeInteger(tests) || tests < 1) {
  console.error("Usage: npm run cost:project -- <evaluation.json...> [--tests 250]");
  process.exitCode = 1;
} else {
  const measured = await profiles(positionals);
  console.log(`Per investigation, and for ${tests} green tests investigated once each.\n`);
  console.log(`            ${"model".padEnd(22)} ${"each".padStart(10)} ${`${tests} tests`.padStart(10)}   token profile`);
  for (const profile of measured) {
    const rate = PUBLISHED_RATES[profile.name];
    if (rate) line(profile.name, rate, profile, tests, true);
    else console.log(`measured   ${profile.name.padEnd(22)} ${"no rate".padStart(10)} ${"published".padStart(10)}   ${profile.inputTokens.toLocaleString()} in / ${profile.outputTokens.toLocaleString()} out`);
  }
  console.log("");
  // Each unrun model is projected twice, once against the most verbose measured
  // profile and once against the tersest, which brackets the plausible bill.
  const verbose = measured[measured.length - 1];
  const terse = measured[0];
  for (const [name, rate] of Object.entries(REFERENCE_RATES)) {
    line(`${name} (verbose)`, rate, verbose, tests, false);
    line(`${name} (terse)`, rate, terse, tests, false);
  }
  console.log(`\nVerbose profile from ${verbose.name}, terse from ${terse.name}, averaged over ${verbose.runs} and ${terse.runs} investigations.`);
  console.log("Projections assume the unrun model reasons at the same length. Output tokens dominate, so that assumption carries the estimate.");
}
