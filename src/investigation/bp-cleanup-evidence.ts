import type { EvidenceSource, Json } from "./types.ts";

type Worker = { id: string; licenseId: string; state: string; slots: { total: number; used: number; available: number }; restoreReported?: boolean };
export type CleanupCapture = {
  schemaVersion: 1;
  test: { passed: true; passedCount: number; skippedCount: 0 };
  baselineLicenseId: string;
  before: { workers: Worker[] };
  after: { workers: Worker[] };
};
type Obj = Record<string, unknown>;
function valid(condition: unknown): asserts condition { if (!condition) throw new Error("Invalid cleanup capture: expected a complete passing report and two worker observations per phase."); }
function object(value: unknown): Obj { valid(value !== null && typeof value === "object" && !Array.isArray(value)); return value as Obj; }
function integer(value: unknown): number { valid(typeof value === "number" && Number.isSafeInteger(value) && value >= 0); return value; }
const states = ["normal", "grace", "demo", "violation"];
function slots(value: unknown) {
  const s = object(value);
  return { total: integer(s.total), used: integer(s.used), available: integer(s.available) };
}

// Reads only exact beforeAll / afterAll endpoint observations and the reporter's
// result summary. All surrounding diagnostics, names and raw logs stay local.
export function extractCleanupCapture(text: string, expectedPassed: number, baselineFingerprint: string) {
  valid(text.length <= 1024 * 1024 && /^[a-f\d]{64}$/.test(baselineFingerprint.replace(/^sha256:/, "")) && baselineFingerprint.startsWith("sha256:"));
  valid(Number.isSafeInteger(expectedPassed) && expectedPassed > 0);
  const lines = text.replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/);
  const summaries = lines.filter(line => /^\s*\d+ passed\s*\(/.test(line));
  valid(summaries.length === 1 && Number(summaries[0].trim().split(" ")[0]) === expectedPassed);
  valid(!lines.some(line => /^\s*\d+ (failed|skipped|interrupted|did not run)\b/.test(line)));
  valid(lines.filter(line => /^\s*✓\s+\d+\s+/.test(line)).length === expectedPassed);
  const names = new Map<string, string>();
  const licenses = new Map<string, string>([[baselineFingerprint, "license-1"]]);
  const before: Worker[] = [], after: Worker[] = [];
  const observations: { phase: "before" | "after"; worker: string; line: number }[] = [];
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^\[(beforeAll|afterAll)\] (\w+) (?:(RESTORED|NOT RESTORED, check manually) )?(\{.*\})\s*$/);
    if (!match) continue;
    const phase = match[1] === "beforeAll" ? "before" : "after";
    valid(phase === "before" ? !match[3] : !!match[3]);
    const data = object(JSON.parse(match[4]));
    valid(typeof data.fingerprint === "string" && /^sha256:[a-f\d]{64}$/.test(data.fingerprint));
    valid(typeof data.state === "string" && states.includes(data.state));
    if (!names.has(match[2])) { valid(phase === "before"); names.set(match[2], `worker-${names.size + 1}`); }
    if (!licenses.has(data.fingerprint)) licenses.set(data.fingerprint, `license-${licenses.size + 1}`);
    const rows = phase === "before" ? before : after;
    const id = names.get(match[2])!;
    valid(!rows.some(row => row.id === id));
    rows.push({ id, licenseId: licenses.get(data.fingerprint)!, state: data.state, slots: slots(data.slots), ...(phase === "after" ? { restoreReported: match[3] === "RESTORED" } : {}) });
    observations.push({ phase, worker: id, line: index + 1 });
  }
  valid(before.length === 2 && after.length === 2);
  // This narrow pilot starts with the designated baseline on both workers.
  // Other starting conditions need a different contract and are rejected here.
  valid(before.every(row => row.licenseId === "license-1" && row.slots.total > 0));
  const capture: CleanupCapture = { schemaVersion: 1, test: { passed: true, passedCount: expectedPassed, skippedCount: 0 }, baselineLicenseId: "license-1", before: { workers: before }, after: { workers: after } };
  return { capture, provenance: { observations, workerIds: Object.fromEntries(names), licenseIds: Object.fromEntries(licenses) } };
}

// Re-project packets from disk so added labels/paths cannot enter model state.
function capture(value: unknown): CleanupCapture {
  const c = object(value), t = object(c.test);
  valid(c.schemaVersion === 1 && t.passed === true && t.skippedCount === 0 && integer(t.passedCount) > 0 && c.baselineLicenseId === "license-1");
  function phase(value: unknown, after: boolean) {
    const rows = object(value).workers;
    valid(Array.isArray(rows) && rows.length === 2);
    const workers = rows.map(value => {
      const row = object(value);
      valid(typeof row.id === "string" && /^worker-[12]$/.test(row.id));
      valid(typeof row.licenseId === "string" && /^license-[1-9]\d*$/.test(row.licenseId));
      valid(typeof row.state === "string" && states.includes(row.state));
      if (after) valid(typeof row.restoreReported === "boolean");
      return { id: row.id, licenseId: row.licenseId, state: row.state, slots: slots(row.slots), ...(after ? { restoreReported: row.restoreReported as boolean } : {}) };
    });
    valid(new Set(workers.map(r => r.id)).size === 2);
    return { workers };
  }
  const before = phase(c.before, false), after = phase(c.after, true);
  valid(before.workers.every(row => row.licenseId === c.baselineLicenseId && row.slots.total > 0));
  return { schemaVersion: 1, test: { passed: true, passedCount: t.passedCount as number, skippedCount: 0 }, baselineLicenseId: c.baselineLicenseId, before, after };
}

export function createCleanupEvidence(currentValue: unknown, referenceValue: unknown): EvidenceSource {
  const current = capture(currentValue), reference = capture(referenceValue);
  valid(reference.after.workers.every(row => row.licenseId === reference.baselineLicenseId && row.slots.total > 0 && row.restoreReported));
  const contract = {
    operation: "Restore the baseline license on every worker after a test",
    requirements: [
      "The test cleanup promises to restore the baseline license on the proxy and both workers. This review evaluates the worker portion of that promise.",
      "The designated baseline license covered both workers before the test. Each worker must hold that baseline again and have positive configured capacity after cleanup.",
      "A RESTORED message is the harness's claim; the recorded worker license identity and configured capacity are the observed result.",
      "Evaluate the post-cleanup state. A worker intentionally excluded during a test can correctly have zero slots before cleanup.",
    ],
    source: { kind: "Documented test-header cleanup promise, reviewed locally; exact run-time test revision is not pinned." },
    limits: "These endpoint values are printed in the test reporter. No independent product-log, proxy-file snapshot, metrics export, or mailbox capture is available for this run. Scope conclusions to observed worker cleanup, not the entire farm or transcription behavior.",
  };
  const database = (c: CleanupCapture) => ({ baselineLicenseId: c.baselineLicenseId, before: c.before, after: c.after, source: "Worker endpoint responses recorded by the test reporter; IDs are pseudonymized." });
  return {
    initial: {
      test: { ...current.test, scenario: "Restore baseline license on every worker after test cleanup" },
      operation: { phase: "afterAll", subject: "Two-worker transcription farm" },
      evidenceScope: "Worker observations immediately before the test and after cleanup; no raw logs or exact observation timestamps.",
    },
    catalog: {
      database_state: "Current before/after worker license identities, reported states, capacity, and the harness's cleanup claims.",
      operation_contract: "The documented cleanup promise and the limits of the captured observations.",
      known_good_run: "Supplied reference worker observations under the same cleanup promise. Contextual evidence, not proof about the current run.",
    },
    required: ["database_state", "operation_contract"],
    async retrieve(key): Promise<Json> {
      if (key === "database_state") return structuredClone(database(current));
      if (key === "operation_contract") return structuredClone(contract);
      if (key === "known_good_run") return { ...structuredClone(database(reference)), comparisonScope: "The reference is not an independent matched rerun of the current test. Build equivalence is not established by this packet. Worker and license IDs are local pseudonyms within each run." };
      throw new Error("Unknown cleanup evidence source");
    },
  };
}
