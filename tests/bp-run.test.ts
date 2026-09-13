import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { parseReceiptFile } from "../src/viewer/model.ts";

async function fixture(t: { after: (fn: () => Promise<unknown>) => void }, body = "") {
  const root = await mkdtemp(join(tmpdir(), "bp-run-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "tests"));
  await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
  await writeFile(join(root, "playwright.config.js"), "module.exports = { testDir: './tests', retries: 0 };\n");
  const spec = `// afterAll restores the baseline license on the proxy and both hosts.
const { test, expect } = require('@playwright/test');
const baseline = 'sha256:' + 'a'.repeat(64), stale = 'sha256:' + 'b'.repeat(64);
const view = (fingerprint, total) => JSON.stringify({ fingerprint, state: 'normal', slots: { total, used: 0, available: total }, gpu: 'PRIVATE_GPU' });
test.beforeAll(() => {
  console.log('[beforeAll] baseline fp=' + baseline);
  for (const host of ['HA2', 'HA3']) console.log('[beforeAll] ' + host + ' ' + view(baseline, 4));
});
test.afterAll(() => {
  for (const host of ['HA2', 'HA3']) console.log('[afterAll] ' + host + ' RESTORED ' + view(stale, 0));
});
test('PRIVATE_CASE', () => { console.log('PRIVATE_DIAGNOSIS company.internal'); ${body} });
`;
  await writeFile(join(root, "tests/C800732.spec.js"), spec);
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "add", "tests", "playwright.config.js"]);
  execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Fixture"]);
  return { root, spec };
}
function run(root: string, args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [resolve("scripts/run-bp-cleanup.ts"), "--repo", root, "--spec", "C800732", ...args], {
    encoding: "utf8", timeout: 30_000,
    env: { ...process.env, TYPESAFE_API_KEY: "", WANDB_API_KEY: "", ...env },
  });
}
async function captureDirectory(root: string) {
  const names = (await readdir(join(root, "scratch"))).filter(n => n.startsWith("beyond-green-run-"));
  assert.equal(names.length, 1);
  return join(root, "scratch", names[0]);
}

test("the wrapper captures an unchanged real Playwright spec and preserves its green exit code offline", async t => {
  const { root, spec } = await fixture(t);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const output = await captureDirectory(root);
  const preview = await readFile(join(output, "outbound-preview.json"), "utf8");
  for (const value of ["PRIVATE", "company.internal", "HA2", "sha256:", root]) assert.equal(preview.includes(value), false, value);
  assert.match(preview, /license-2/);
  const evaluation = await readFile(join(output, "evaluation.json"), "utf8");
  const receipt = JSON.parse(evaluation);
  assert.equal(receipt.testExitCode, 0);
  assert.equal(receipt.status, "captured");
  assert.equal(receipt.rows[0].reason, "provider_not_requested");
  assert.equal(parseReceiptFile(evaluation).runs[0].testPassed, true);
  assert.equal(await readFile(join(root, "tests/C800732.spec.js"), "utf8"), spec);
  const provenance = JSON.parse(await readFile(join(output, "provenance.json"), "utf8"));
  assert.equal(provenance.codeUnchanged, true);
  assert.match(provenance.before.revision, /^[a-f0-9]{40}$/);
  const report = JSON.parse(await readFile(join(output, "reporter.json"), "utf8"));
  assert.equal(report.plannedTests, 1);
  assert.equal(report.tests[0].status, "passed");
  assert.ok(report.events.some((event: { text: string; receivedAt: string }) => event.text.includes("[afterAll]") && event.receivedAt));
});

test("an unavailable provider cannot fail a passing test", async t => {
  const { root } = await fixture(t);
  const result = run(root, ["--send-to-typesafe", "--trace"]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const output = await captureDirectory(root);
  const receipt = JSON.parse(await readFile(join(output, "evaluation.json"), "utf8"));
  assert.equal(receipt.testExitCode, 0);
  assert.equal(receipt.rows[0].verdict, "insufficient");
  assert.equal(receipt.rows[0].reason, "provider_error");
});

test("failed and skipped tests never reach a provider or masquerade as fully passing runs", async t => {
  for (const [body, code, passed] of [["expect(1).toBe(2)", 1, false], ["test.skip()", 0, null]] as const) {
    const { root } = await fixture(t, body);
    const result = run(root, ["--send-to-typesafe"]);
    assert.equal(result.status, code, result.stderr + result.stdout);
    const output = await captureDirectory(root);
    const evaluation = await readFile(join(output, "evaluation.json"), "utf8");
    const receipt = JSON.parse(evaluation);
    assert.equal(receipt.rows[0].verdict, "insufficient");
    assert.notEqual(receipt.rows[0].reason, "provider_error");
    assert.equal(parseReceiptFile(evaluation).runs[0].testPassed, passed);
    assert.equal((await readdir(output)).includes("outbound-preview.json"), false);
  }
});

test("a regression judgment keeps the test green and sends only the projected packet", async t => {
  const { root } = await fixture(t);
  const preload = join(root, "provider-fixture.mjs");
  await writeFile(preload, `import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, init) => {
  if (url !== 'https://api.typesafe.ai/v1/systemone') throw new Error('Unexpected network request');
  appendFileSync(process.env.FIXTURE_REQUESTS, init.body + '\\n');
  const { state, questions } = JSON.parse(init.body);
  const missing = ['database_state', 'operation_contract'].find(key => !state.retrieved[key]);
  const choices = { hypothesis: 'suspected_violation', assessment: missing ? 'insufficient' : 'supported', next_evidence: missing || 'none', verdict: 'regression', grounding: 'sufficient' };
  return Response.json({ model: 'jev-fixture', usage: { input_tokens: 10, output_tokens: 2 },
    answers: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, {
      type: 'choice', choice: choices[id], confidence: 1,
      probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, key === choices[id] ? 1 : 0]))
    }])) });
};\n`);
  const requests = join(root, "requests.jsonl");
  const result = run(root, ["--send-to-typesafe"], { TYPESAFE_API_KEY: "fixture-key", NODE_OPTIONS: `--import=${preload}`, FIXTURE_REQUESTS: requests });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const receipt = JSON.parse(await readFile(join(await captureDirectory(root), "evaluation.json"), "utf8"));
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.rows[0].verdict, "regression");
  assert.deepEqual(receipt.rows[0].evidenceIds, ["database_state", "operation_contract"]);
  assert.equal(receipt.rows[0].usage.inputTokens, 70);
  const outbound = await readFile(requests, "utf8");
  for (const value of ["PRIVATE", "company.internal", "HA2", "sha256:", root, "fixture-key"]) assert.equal(outbound.includes(value), false, value);
});

test("a stalled provider is bounded without changing a passing Playwright exit", async t => {
  const { root } = await fixture(t);
  const preload = join(root, "stalled-provider.mjs");
  await writeFile(preload, "globalThis.fetch = () => new Promise(() => { setInterval(() => {}, 1000); });\n");
  const result = run(root, ["--send-to-typesafe", "--investigation-timeout-ms", "300"], { TYPESAFE_API_KEY: "fixture-key", NODE_OPTIONS: `--import=${preload}` });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const receipt = JSON.parse(await readFile(join(await captureDirectory(root), "evaluation.json"), "utf8"));
  assert.equal(receipt.rows[0].verdict, "insufficient");
  assert.equal(receipt.rows[0].reason, "provider_timeout");
});

test("source changes and missing cleanup observations produce insufficient evidence without a provider call", async t => {
  for (const changed of [true, false]) {
    const { root, spec } = await fixture(t, changed ? "require('node:fs').appendFileSync(__filename, '\\n// changed during execution\\n')" : "");
    if (!changed) await writeFile(join(root, "tests/C800732.spec.js"), spec.replace("console.log('[afterAll] '", "if (host === 'HA2') console.log('[afterAll] '"));
    const result = run(root, ["--send-to-typesafe"]);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const receipt = JSON.parse(await readFile(join(await captureDirectory(root), "evaluation.json"), "utf8"));
    assert.equal(receipt.rows[0].reason, changed ? "code_changed" : "capture_incomplete");
    assert.equal(receipt.rows[0].verdict, "insufficient");
  }
});

test("dry runs perform no test execution or capture writes, and a lock prevents a second wrapper", async t => {
  const { root } = await fixture(t);
  const result = run(root, ["--dry-run", "--send-to-typesafe", "--trace"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await readdir(root)).includes("scratch"), false);
  await mkdir(join(root, "scratch/.beyond-green-run.lock"), { recursive: true });
  assert.equal(run(root).status, 1);
  assert.deepEqual(await readdir(join(root, "scratch")), [".beyond-green-run.lock"]);
});
