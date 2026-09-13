import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { extractCleanupCapture, createCleanupEvidence } from "../src/investigation/bp-cleanup-evidence.ts";

const baseline = `sha256:${"a".repeat(64)}`;
const stale = `sha256:${"b".repeat(64)}`;
function reporter(broken: boolean) {
  const view = (fingerprint: string, total: number) => JSON.stringify({ fingerprint, state: total ? "grace" : "normal", slots: { total, used: 0, available: total }, gpu: "PRIVATE_GPU" });
  return [
    "PRIVATE_DIAGNOSIS /Users/private/case-C2 company.internal",
    `[beforeAll] HA2 ${view(baseline, 4)}`, `[beforeAll] HA3 ${view(baseline, 4)}`,
    `[7] already diagnosed the wrong license (PRIVATE_DIAGNOSIS)`,
    `[afterAll] HA2 RESTORED ${view(broken ? stale : baseline, broken ? 0 : 4)}`,
    `[afterAll] HA3 RESTORED ${view(broken ? stale : baseline, broken ? 0 : 4)}`,
    "  ✓ 1 tests/private.spec.js:10:3 › one (1s)", "  ✓ 2 tests/private.spec.js:20:3 › two (1s)",
    "  2 passed (3s)",
  ].join("\n");
}

test("a passing reporter yields only pseudonymized endpoint observations and keeps zero capacity", async () => {
  const current = extractCleanupCapture(reporter(true), 2, baseline);
  const reference = extractCleanupCapture(reporter(false), 2, baseline);
  const source = createCleanupEvidence(current.capture, reference.capture);
  const packet = JSON.stringify({ initial: source.initial, db: await source.retrieve("database_state"), contract: await source.retrieve("operation_contract"), reference: await source.retrieve("known_good_run") });
  for (const forbidden of [baseline, stale, "PRIVATE", "HA2", "HA3", "company.internal", "/Users/", "case-C2", "regression"]) assert.equal(packet.includes(forbidden), false, forbidden);
  assert.equal(current.capture.after.workers[0].slots.total, 0);
  assert.equal(current.capture.after.workers[0].licenseId, "license-2");
  assert.equal(reference.capture.after.workers[0].licenseId, "license-1");
  assert.equal(current.capture.test.passedCount, 2);
  assert.deepEqual(current.provenance.observations.map(o => o.line), [2, 3, 5, 6]);
});

test("rejects incomplete or failing reports and a reference whose cleanup failed", () => {
  for (const text of [
    reporter(true).replace("2 passed (3s)", "1 failed\n  1 passed (3s)"),
    reporter(true) + "\n  1 skipped",
    reporter(true).split("\n").filter(line => !line.startsWith("[afterAll] HA3")).join("\n"),
    reporter(true) + `\n[afterAll] HA2 RESTORED ${JSON.stringify({fingerprint: baseline, state: "grace", slots: {total: 4, used: 0, available: 4}})}`,
  ]) assert.throws(() => extractCleanupCapture(text, 2, baseline), /Invalid cleanup capture/);
  const bad = extractCleanupCapture(reporter(true), 2, baseline).capture;
  assert.throws(() => createCleanupEvidence(bad, bad), /Invalid cleanup capture/);
  const clean = extractCleanupCapture(reporter(false), 2, baseline).capture;
  const corrupt = structuredClone(bad);
  corrupt.after.workers[0].licenseId = "PRIVATE_LICENSE";
  assert.throws(() => createCleanupEvidence(corrupt, clean), /Invalid cleanup capture/);
});

test("prepares a checksummed private packet and dry-runs without credentials or provider calls", async t => {
  const directory = await mkdtemp(join(tmpdir(), "cleanup-pilot-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "scratch"));
  const run = reporter(true), reference = `[beforeAll] baseline fp=${baseline}\n${reporter(false)}`;
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  await writeFile(join(directory, "run.log"), run);
  await writeFile(join(directory, "reference.log"), reference);
  await writeFile(join(directory, "manifest.sha256"), `${hash(run)}  run.log\n${hash(reference)}  reference.log\n`);
  await writeFile(join(directory, "spec.js"), "// afterAll restores the baseline license on the proxy and both hosts.\n");
  execFileSync(process.execPath, [resolve("scripts/prepare-bp-cleanup.ts"), "--repo", directory, "--manifest", "manifest.sha256", "--run-log", "run.log", "--reference-log", "reference.log", "--run-tests", "2", "--reference-tests", "2", "--contract-file", "spec.js"]);
  const [name] = await readdir(join(directory, "scratch"));
  const packet = join(directory, "scratch", name);
  const preview = await readFile(join(packet, "outbound-preview.json"), "utf8");
  assert.equal(preview.includes("PRIVATE"), false);
  assert.equal(preview.includes("sha256:"), false);
  const output = execFileSync(process.execPath, [resolve("scripts/replay-bp-cleanup.ts"), "--packet", packet], { env: { ...process.env, TYPESAFE_API_KEY: "", WANDB_API_KEY: "" }, encoding: "utf8" });
  assert.match(output, /No network calls/);
  assert.equal((await readdir(packet)).some(n => n.startsWith("replay-")), false);
  await writeFile(join(packet, "run.json"), "{}");
  assert.throws(() => execFileSync(process.execPath, [resolve("scripts/replay-bp-cleanup.ts"), "--packet", packet], { stdio: "pipe" }));
});
