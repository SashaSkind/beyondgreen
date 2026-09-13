import { createHash, randomUUID } from "node:crypto";
import { spawn, execFileSync, execFile } from "node:child_process";
import { readFile, realpath, stat, mkdir, mkdtemp, writeFile, open, rm } from "node:fs/promises";
import { join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { createCleanupEvidence, extractLiveCleanupCapture } from "../src/investigation/bp-cleanup-evidence.ts";

const { values } = parseArgs({ options: {
  repo: { type: "string" }, spec: { type: "string" }, "baseline-fingerprint": { type: "string" },
  "dry-run": { type: "boolean", default: false },
  "send-to-typesafe": { type: "boolean", default: false }, trace: { type: "boolean", default: false },
  "investigation-timeout-ms": { type: "string", default: "120000" },
} });
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const promise = "afterAll restores the baseline license on the proxy and both hosts.";
let testExitCode: number | undefined;
async function main() {
  if (!values.repo || !["C800732", "C800738-partB"].includes(values.spec ?? "")) throw new Error("Usage: npm run bp:run -- --repo <private-repo> --spec <C800732|C800738-partB> [--baseline-fingerprint sha256:...] [--dry-run]");
  const baseline = values["baseline-fingerprint"];
  const investigationTimeout = Number(values["investigation-timeout-ms"]);
  if (!Number.isInteger(investigationTimeout) || investigationTimeout < 100 || investigationTimeout > 300000) throw new Error("Investigation timeout must be between 100 and 300000 ms.");
  if ((baseline && !/^sha256:[a-f\d]{64}$/.test(baseline)) || (values.spec === "C800738-partB" && !baseline)) throw new Error("Part B requires --baseline-fingerprint from the designated baseline license; fingerprints must be sha256 followed by 64 lowercase hex digits.");
  const root = await realpath(resolve(values.repo));
  async function localFile(name: string) {
    const path = await realpath(join(root, name));
    const rel = relative(root, path);
    if (rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith(sep) || (await stat(path)).size > 1024 * 1024) throw new Error("Selected source must be a local file under 1 MB.");
    return { path, bytes: await readFile(path) };
  }
  const specName = `tests/${values.spec}.spec.js`;
  const spec = await localFile(specName);
  const config = await localFile("playwright.config.js");
  if (!spec.bytes.toString().includes(promise)) throw new Error("Selected spec does not document the supported cleanup promise.");
  const cli = join(root, "node_modules/@playwright/test/cli.js");
  await stat(cli);
  const reporter = fileURLToPath(new URL("./bp-cleanup-reporter.cjs", import.meta.url));
  // Exact one-file filter; no retries, repeats, or concurrent workers.
  const args = [cli, "test", `${specName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "--config", config.path,
    "--workers=1", "--retries=0", "--repeat-each=1", "--reporter", reporter];
  if (values["dry-run"]) {
    console.log(`Dry run: would run ${values.spec} once, save private evidence, and preserve Playwright's exit code. No tests or provider calls started.`);
    return;
  }
  const scratch = join(root, "scratch");
  await mkdir(scratch, { recursive: true });
  if (await realpath(scratch) !== scratch) throw new Error("Private scratch must not be a symbolic link.");
  const lock = join(scratch, ".beyond-green-run.lock");
  try { await mkdir(lock, { mode: 0o700 }); }
  catch { throw new Error("Another wrapper may be running. Check scratch/.beyond-green-run.lock before starting another farm run."); }
  try {
    const output = await mkdtemp(join(scratch, "beyond-green-run-"));
    const save = async (name: string, data: unknown) => writeFile(join(output, name), JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    async function codeState() {
      const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      return { revision: git("rev-parse", "HEAD").trim(),
        trackedDiffSha256: sha(git("diff", "HEAD", "--", ".", ":(exclude)scratch", ":(exclude)test-results")),
        specSha256: sha(await readFile(spec.path)), configSha256: sha(await readFile(config.path)) };
    }
    const before = await codeState();
    await writeFile(join(output, "executed-spec.js"), spec.bytes, { flag: "wx", mode: 0o600 });
    await writeFile(join(output, "executed-config.js"), config.bytes, { flag: "wx", mode: 0o600 });
    const startedAt = new Date().toISOString();
    console.log(`Running ${values.spec}. Private capture: ${output}`);
    const log = await open(join(output, "process.log"), "wx", 0o600);
    let signal: NodeJS.Signals | null = null;
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, BEYOND_GREEN_REPORT: join(output, "reporter.json") };
      delete env.TYPESAFE_API_KEY; delete env.WANDB_API_KEY;
      const child = spawn(process.execPath, [...args, "--output", join(output, "playwright-artifacts")], { cwd: root, env, stdio: ["inherit", log.fd, log.fd] });
      const forwardInt = () => child.kill("SIGINT"), forwardTerm = () => child.kill("SIGTERM");
      process.on("SIGINT", forwardInt); process.on("SIGTERM", forwardTerm);
      try {
        testExitCode = await new Promise<number>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code, endedSignal) => { signal = endedSignal; resolve(code ?? (endedSignal === "SIGINT" ? 130 : endedSignal === "SIGTERM" ? 143 : 1)); });
        });
      } finally { process.off("SIGINT", forwardInt); process.off("SIGTERM", forwardTerm); }
    } finally { await log.close(); }
    const endedAt = new Date().toISOString();
    // From this point onward no capture/provider problem may replace the test's
    // exit code. The durable receipt carries the separate investigation status.
    const row = { investigationId: randomUUID(), displayTitle: "Worker cleanup · fresh run", provider: "typesafe",
      verdict: "insufficient", reason: "capture_incomplete", scope: "observed operation only", initial: { test: { passed: (testExitCode === 0 ? null : false) as boolean | null } },
      hypotheses: [], evidenceIds: [], retrieved: {}, steps: [], usage: { inputTokens: 0, outputTokens: 0 }, latencyMs: 0, minConfidence: 0.8, costUsd: null };
    const evaluation = { title: "Private worker-cleanup run", reportOnly: true, testExitCode, signal, startedAt, endedAt,
      status: "insufficient", rows: [row] };
    await save("evaluation.json", evaluation);
    try {
      const after = await codeState();
      const codeUnchanged = JSON.stringify(before) === JSON.stringify(after) && before.specSha256 === sha(spec.bytes) && before.configSha256 === sha(config.bytes);
      const provenance = { repo: root, spec: specName, before, after, codeUnchanged, startedAt, endedAt,
        limitation: "Hashes cover the selected spec, config, and tracked diff, not untracked dependencies or the remote deployed build. Reporter event times are receipt times, not server observation times." };
      await save("provenance.json", provenance);
      if (!codeUnchanged) throw new Error("code_changed");
      if (testExitCode !== 0) throw new Error("test_not_green");
      const reportBytes = await readFile(join(output, "reporter.json"));
      if (reportBytes.length > 8 * 1024 * 1024) throw new Error("capture_incomplete");
      const report = JSON.parse(reportBytes.toString());
      if (!Array.isArray(report.tests) || !report.tests.every((t: { file?: string }) => t.file === spec.path)) throw new Error("capture_incomplete");
      if (report.status === "passed" && report.errors === 0 && report.tests.length > 0 && report.tests.length === report.plannedTests &&
        report.tests.every((t: { status: string; expectedStatus: string; retry: number }) => t.status === "passed" && t.expectedStatus === "passed" && t.retry === 0)) row.initial.test.passed = true;
      const extracted = extractLiveCleanupCapture(report, baseline);
      await save("provenance.json", { ...provenance, ...extracted.provenance, reporterSha256: sha(reportBytes) });
      const source = createCleanupEvidence(extracted.capture);
      await save("run.json", extracted.capture);
      await save("packet-hashes.json", { "run.json": sha(await readFile(join(output, "run.json"))) });
      await save("outbound-preview.json", { initial: source.initial, catalog: source.catalog, required: source.required,
        evidence: Object.fromEntries(await Promise.all(Object.keys(source.catalog).map(async key => [key, await source.retrieve(key)]))) });
      row.initial = { test: { ...extracted.capture.test } };
      row.reason = "provider_not_requested";
      evaluation.status = "captured";
    } catch (error) {
      row.reason = error instanceof Error && ["code_changed", "test_not_green"].includes(error.message) ? error.message : "capture_incomplete";
    }
    await save("evaluation.json", evaluation);
    if (evaluation.status === "captured" && values["send-to-typesafe"]) {
      console.log("Capture qualified. Starting the report-only investigation.");
      try {
        await promisify(execFile)(process.execPath, [fileURLToPath(new URL("./investigate-bp-capture.ts", import.meta.url)), "--capture", output, ...(values.trace ? ["--trace"] : [])],
          { timeout: investigationTimeout, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
      } catch (error) {
        const latest = JSON.parse(await readFile(join(output, "evaluation.json"), "utf8"));
        // A completed judgment remains available even if its trace verification
        // timed out. Failure to trace is recorded separately from the verdict.
        if (latest.status === "captured") {
          latest.status = "insufficient";
          latest.rows[0].reason = error && typeof error === "object" && "killed" in error && error.killed ? "provider_timeout" : "provider_error";
        } else { latest.status = "trace_unverified"; }
        await save("evaluation.json", latest);
      }
    }
    const final = JSON.parse(await readFile(join(output, "evaluation.json"), "utf8"));
    console.log(`Playwright exit: ${testExitCode}. Beyond Green: ${final.rows[0].verdict} (${final.rows[0].reason}).\nOpen receipt: ${join(output, "evaluation.json")}`);
  } finally { await rm(lock, { recursive: true }); }
}
try { await main(); } catch { console.error("Unable to complete the wrapper. Check arguments, repository access, and the private capture files."); process.exitCode = 1; }
if (testExitCode !== undefined) process.exitCode = testExitCode;
