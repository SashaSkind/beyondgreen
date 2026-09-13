import { createHash } from "node:crypto";
import { readFile, realpath, mkdtemp, mkdir, writeFile, stat } from "node:fs/promises";
import { resolve, join, relative, sep } from "node:path";
import { parseArgs } from "node:util";
import { extractCleanupCapture, createCleanupEvidence } from "../src/investigation/bp-cleanup-evidence.ts";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const { values } = parseArgs({ options: {
  repo: { type: "string" }, "run-log": { type: "string" }, "reference-log": { type: "string" },
  "run-tests": { type: "string" }, "reference-tests": { type: "string" },
  manifest: { type: "string" }, "contract-file": { type: "string" },
} });
async function main() {
  if (Object.values(values).length !== 7 || Object.values(values).some(v => !v)) throw new Error("Usage: npm run bp:prepare -- --repo <private-repo> --manifest <relative-sha256-file> --run-log <relative-log> --reference-log <relative-log> --run-tests <count> --reference-tests <count> --contract-file <relative-spec>");
  const root = await realpath(resolve(values.repo!));
  async function localFile(name: string) {
    const path = await realpath(resolve(root, name));
    const rel = relative(root, path);
    if (rel.startsWith(`..${sep}`) || rel === ".." || rel.startsWith(sep)) throw new Error("Input must stay inside the private repository.");
    if ((await stat(path)).size > 1024 * 1024) throw new Error("Selected input exceeds 1 MB.");
    return { path, relative: rel, bytes: await readFile(path) };
  }
  const manifest = await localFile(values.manifest!);
  const hashes = new Map(manifest.bytes.toString().split(/\r?\n/).filter(Boolean).map(line => {
    const match = line.match(/^([a-f\d]{64})\s+\*?(.+)$/);
    if (!match) throw new Error("Malformed capture checksum manifest.");
    return [match[2], match[1]];
  }));
  const run = await localFile(values["run-log"]!), reference = await localFile(values["reference-log"]!);
  for (const file of [run, reference]) if (hashes.get(file.relative) !== sha(file.bytes)) throw new Error("Selected capture does not match its checksum manifest.");
  const contract = await localFile(values["contract-file"]!);
  const promise = "afterAll restores the baseline license on the proxy and both hosts.";
  if (!contract.bytes.toString().includes(promise)) throw new Error("The selected spec does not document the supported cleanup promise.");
  const baseline = reference.bytes.toString().match(/^\[beforeAll\] baseline fp=(sha256:[a-f\d]{64})\b/m)?.[1];
  if (!baseline) throw new Error("The reference does not identify its designated baseline license.");
  const current = extractCleanupCapture(run.bytes.toString(), Number(values["run-tests"]), baseline);
  const control = extractCleanupCapture(reference.bytes.toString(), Number(values["reference-tests"]), baseline);
  const source = createCleanupEvidence(current.capture, control.capture);
  // Exhaust the lazy sources for a concrete, reviewable outbound preview.
  const preview = { initial: source.initial, catalog: source.catalog, required: source.required, evidence: Object.fromEntries(await Promise.all(Object.keys(source.catalog).map(async key => [key, await source.retrieve(key)]))) };
  const scratch = join(root, "scratch");
  await mkdir(scratch, { recursive: true });
  if (await realpath(scratch) !== scratch) throw new Error("Private scratch must not be a symbolic link.");
  const directory = await mkdtemp(join(scratch, "beyond-green-cleanup-"));
  const files: Record<string, unknown> = {
    "run.json": current.capture, "reference.json": control.capture, "outbound-preview.json": preview,
    "provenance.json": {
      collectedAt: new Date().toISOString(), collection: "Offline extraction of existing test-reporter artifacts; no services contacted.",
      run: { path: run.path, sha256: sha(run.bytes), ...current.provenance },
      reference: { path: reference.path, sha256: sha(reference.bytes), ...control.provenance },
      contract: { path: contract.path, sha256: sha(contract.bytes), quote: promise, limitation: "Current spec header checked; original executed revision not independently established." },
      manifest: { path: manifest.path, sha256: sha(manifest.bytes) },
      qualification: "Different tests sharing a cleanup promise. Reporter excerpts only. Local provenance and identity mappings must not be supplied to a judge.",
    },
  };
  const outputHashes: Record<string, string> = {};
  for (const [name, value] of Object.entries(files)) {
    const text = JSON.stringify(value, null, 2) + "\n";
    await writeFile(join(directory, name), text, { flag: "wx", mode: 0o600 });
    outputHashes[name] = sha(text);
  }
  await writeFile(join(directory, "packet-hashes.json"), JSON.stringify(outputHashes, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(`Private capture prepared: ${directory}\nNo model calls. Review outbound-preview.json before authorizing a provider replay.`);
}
try { await main(); } catch (error) { console.error(error instanceof Error && !/ENOENT|EACCES|JSON/.test(error.message) ? error.message : "Unable to prepare the selected private capture."); process.exitCode = 1; }
