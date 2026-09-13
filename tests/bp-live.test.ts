import assert from "node:assert/strict";
import { test } from "node:test";
import { extractLiveCleanupCapture, createCleanupEvidence } from "../src/investigation/bp-cleanup-evidence.ts";

const baseline = `sha256:${"a".repeat(64)}`;
const stale = `sha256:${"b".repeat(64)}`;
function report() {
  const view = (fingerprint: string, total: number) => JSON.stringify({ fingerprint, state: "normal", slots: { total, used: 0, available: total }, gpu: "PRIVATE_GPU" });
  return {
    schemaVersion: 1, status: "passed", plannedTests: 1, errors: 0, truncated: false,
    tests: [{ id: "PRIVATE_CASE", status: "passed", expectedStatus: "passed", retry: 0 }],
    stdout: ["PRIVATE_DIAGNOSIS", `[beforeAll] baseline fp=${baseline}`,
      `[beforeAll] HA2 ${view(baseline, 4)}`, `[beforeAll] HA3 ${view(baseline, 4)}`,
      `[afterAll] HA2 RESTORED ${view(stale, 0)}`, `[afterAll] HA3 RESTORED ${view(stale, 0)}`].join("\n"),
  };
}

test("a fresh green run uses its own designated baseline and needs no reference replay", async () => {
  const extracted = extractLiveCleanupCapture(report());
  const source = createCleanupEvidence(extracted.capture);
  assert.equal(extracted.capture.test.passedCount, 1);
  assert.equal(extracted.capture.after.workers[0].licenseId, "license-2");
  assert.equal(extracted.capture.after.workers[0].slots.total, 0);
  assert.deepEqual(Object.keys(source.catalog), ["database_state", "operation_contract"]);
  const outbound = JSON.stringify({ initial: source.initial, db: await source.retrieve("database_state"), contract: await source.retrieve("operation_contract") });
  for (const secret of ["PRIVATE", "HA2", "HA3", baseline, stale]) assert.equal(outbound.includes(secret), false);
  assert.equal(outbound.includes("original executed revision not"), false);
});

test("incomplete, retried, unexpected, or out-of-order runs cannot qualify as clean evidence", () => {
  const original = report();
  for (const changed of [
    { ...original, status: "failed" }, { ...original, errors: 1 }, { ...original, truncated: true },
    { ...original, plannedTests: 2 },
    ...["skipped", "failed", "interrupted", "timedOut"].map(status => ({ ...original, tests: [{ ...original.tests[0], status }] })),
    { ...original, tests: [{ ...original.tests[0], expectedStatus: "failed" }] },
    { ...original, tests: [{ ...original.tests[0], retry: 1 }] },
    { ...original, stdout: original.stdout.split("\n").filter(l => !l.startsWith("[afterAll] HA3")).join("\n") },
    { ...original, stdout: original.stdout.split("\n").map((l, i, a) => i === 3 ? a[4] : i === 4 ? a[3] : l).join("\n") },
  ]) assert.throws(() => extractLiveCleanupCapture(changed), /Invalid cleanup capture/);
  assert.throws(() => extractLiveCleanupCapture(original, stale));
  const partB = { ...original, stdout: original.stdout.replace(`[beforeAll] baseline fp=${baseline}\n`, "") };
  assert.throws(() => extractLiveCleanupCapture(partB));
  assert.equal(extractLiveCleanupCapture(partB, baseline).capture.baselineLicenseId, "license-1");
});
