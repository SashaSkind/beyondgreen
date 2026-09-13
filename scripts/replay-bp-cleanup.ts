import { randomUUID, createHash } from "node:crypto";
import { readFile, realpath, stat, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createCleanupEvidence } from "../src/investigation/bp-cleanup-evidence.ts";
import { investigate } from "../src/investigation/engine.ts";
import { createTypeSafeJudge } from "../src/investigation/typesafe.ts";

const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const { values } = parseArgs({ options: { packet: { type: "string" }, "send-to-typesafe": { type: "boolean", default: false } } });
async function main() {
  if (!values.packet) throw new Error("Usage: npm run bp:replay -- --packet <private-packet-directory> [--send-to-typesafe]");
  const directory = await realpath(values.packet);
  async function read(name: string) {
    const path = join(directory, name);
    if (await realpath(path) !== path || (await stat(path)).size > 1024 * 1024) throw new Error("Packet files must be ordinary local files under 1 MB.");
    return readFile(path);
  }
  const hashBytes = await read("packet-hashes.json");
  const hashes = JSON.parse(hashBytes.toString());
  const runBytes = await read("run.json"), refBytes = await read("reference.json");
  if (sha(runBytes) !== hashes["run.json"] || sha(refBytes) !== hashes["reference.json"]) throw new Error("Packet checksum mismatch; prepare the capture again.");
  const current = JSON.parse(runBytes.toString()), reference = JSON.parse(refBytes.toString());
  const sources = [createCleanupEvidence(reference, reference), createCleanupEvidence(current, reference)];
  const inspectedPackets = await Promise.all(sources.map(async source => ({
    initial: source.initial, catalog: source.catalog, required: source.required,
    evidence: Object.fromEntries(await Promise.all(Object.keys(source.catalog).map(async key => [key, await source.retrieve(key)]))),
  })));
  if (!values["send-to-typesafe"]) {
    console.log(`Validated two worker-cleanup inputs (${Buffer.byteLength(JSON.stringify(inspectedPackets))} bytes before model questions). No network calls.\nAdd --send-to-typesafe only when this minimal packet is authorized for that provider. W&B/Weave tracing is not used.`);
    return;
  }
  const judge = createTypeSafeJudge();
  const replayId = randomUUID();
  const output = join(directory, `replay-${replayId}`);
  await mkdir(output, { mode: 0o700 });
  const rows = [];
  for (const [index, source] of sources.entries()) {
    const result = await investigate(source, judge);
    const row = { ...result, investigationId: randomUUID(), provider: "typesafe", displayTitle: index === 0 ? "Worker cleanup · reference" : "Worker cleanup · candidate", traceVerified: false, traceUrl: null };
    rows.push(row);
    await writeFile(join(output, `${index === 0 ? "reference" : "candidate"}.json`), JSON.stringify(row, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    console.log(`${index === 0 ? "Reference" : "Candidate"}: ${result.verdict} (${result.reason}), ${(result.latencyMs / 1000).toFixed(2)} s`);
  }
  const unchanged = sha(await read("run.json")) === sha(runBytes) && sha(await read("reference.json")) === sha(refBytes) && sha(await read("packet-hashes.json")) === sha(hashBytes);
  const receipt = { replayId, title: "Private worker-cleanup pilot", rows, complete: unchanged,
    qualification: "One development pair. Different test workflows sharing a cleanup promise. The reference uses itself as context; this is not an independent matched control or a reliability benchmark.",
    tracing: "disabled", inputHashes: { run: sha(runBytes), reference: sha(refBytes) },
  };
  await writeFile(join(output, "evaluation.json"), JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  console.log(`Private replay saved: ${join(output, "evaluation.json")}`);
  if (!unchanged) throw new Error("Inputs changed during replay; results are not qualified.");
  if (rows.some(row => row.verdict === "insufficient")) process.exitCode = 2;
}
try { await main(); } catch (error) { console.error(error instanceof Error && !/ENOENT|EACCES|JSON/.test(error.message) ? error.message : "Unable to read or replay the private packet."); process.exitCode = 1; }
