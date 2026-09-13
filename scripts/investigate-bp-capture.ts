// Isolated child process: the wrapper bounds provider and trace work without
// interrupting Playwright cleanup or letting a model failure replace its status.
import { readFile, realpath, stat, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { createCleanupEvidence } from "../src/investigation/bp-cleanup-evidence.ts";
import { investigate } from "../src/investigation/engine.ts";
import { createTypeSafeJudge } from "../src/investigation/typesafe.ts";

const { values } = parseArgs({ options: { capture: { type: "string" }, trace: { type: "boolean", default: false } } });
async function main() {
  if (!values.capture) throw new Error("capture");
  const root = await realpath(values.capture);
  async function read(name: string) {
    const path = join(root, name);
    if (await realpath(path) !== path || (await stat(path)).size > 1024 * 1024) throw new Error("capture");
    return readFile(path);
  }
  const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const bytes = await read("run.json"), hashBytes = await read("packet-hashes.json");
  if (sha(bytes) !== JSON.parse(hashBytes.toString())["run.json"]) throw new Error("checksum");
  const evaluation = JSON.parse((await read("evaluation.json")).toString());
  if (evaluation.status !== "captured" || evaluation.testExitCode !== 0 || evaluation.rows?.length !== 1) throw new Error("capture");
  const source = createCleanupEvidence(JSON.parse(bytes.toString()));
  const judge = createTypeSafeJudge();
  const id = evaluation.rows[0].investigationId;
  async function save() {
    await writeFile(join(root, "evaluation.tmp.json"), JSON.stringify(evaluation, null, 2) + "\n", { mode: 0o600 });
    await rename(join(root, "evaluation.tmp.json"), join(root, "evaluation.json"));
  }
  let tracing = null;
  if (values.trace) {
    const project = process.env.WEAVE_PROJECT?.trim() || "beyond-green";
    if (!process.env.WANDB_API_KEY?.trim() || !/^[\w-]+(?:\/[\w-]+)?$/.test(project)) throw new Error("tracing");
    const weave = await import("weave");
    const helpers = await import("../src/investigation/tracing.ts");
    tracing = { client: await weave.init(project), ...helpers };
  }
  const traced = tracing ? await tracing.createTracedInvestigation(source, judge).invoke(id) : null;
  const result = traced ? traced[0] : await investigate(source, judge);
  if (sha(await read("run.json")) !== sha(bytes) || sha(await read("packet-hashes.json")) !== sha(hashBytes)) throw new Error("checksum");
  const callId = traced?.[1].id;
  const row = { ...evaluation.rows[0], ...result, initial: source.initial, traceVerified: false,
    traceUrl: tracing && callId ? `https://wandb.ai/${tracing.client.projectId}/r/call/${callId}` : null, verifiedChildCalls: 0 };
  evaluation.rows = [row];
  evaluation.status = "completed";
  evaluation.tracing = tracing ? "pending_verification" : "disabled";
  evaluation.inputHashes = { run: sha(bytes) };
  await save();
  if (tracing && callId) {
    try {
      row.verifiedChildCalls = await tracing.verifyInvestigationTrace(tracing.client, callId, id, result);
      row.traceVerified = true;
      evaluation.tracing = "verified";
    } catch { evaluation.tracing = "unverified"; evaluation.status = "trace_unverified"; }
    await save();
  }
}
try { await main(); } catch { console.error("Unable to investigate the private capture."); process.exitCode = 1; }
