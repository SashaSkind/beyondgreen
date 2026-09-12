import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";

export type BenchmarkCase = {
  id: string; expected: "clean" | "regression"; currentDir: string; baselineDir: string;
  hashes: Record<string, string>;
};
const files = ["evidence.json", "database-before.json", "database-after.json"];
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid suite object");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid suite string");
  return value;
}

export async function loadBenchmarkSuite(path: string) {
  const bytes = await readFile(path);
  const data = record(JSON.parse(bytes.toString("utf8")));
  if (data.schema_version !== 1 || data.complete !== true || !Array.isArray(data.cases) || !data.cases.length || data.cases.length > 100) {
    throw new Error("Expected a complete, nonempty suite");
  }
  const baseline = resolve(dirname(path), string(data.baseline));
  const cases: BenchmarkCase[] = data.cases.map((value) => {
    const row = record(value);
    const validation = record(row.validation);
    const expected = row.expected;
    if ((expected !== "clean" && expected !== "regression") || validation.experiment_valid !== true ||
        validation.upstream_test_passed !== true || validation.application_correct !== (expected === "clean")) {
      throw new Error("Invalid suite ground truth");
    }
    const baselineDir = resolve(dirname(path), string(row.baselineDir));
    if (baselineDir !== baseline) throw new Error("Suite references different baselines");
    const hashes = record(record(row.provenance).artifact_sha256);
    return {
      id: string(row.id), expected, currentDir: resolve(dirname(path), string(row.currentDir)), baselineDir,
      hashes: Object.fromEntries(files.map((file) => {
        const hash = string(hashes[file]);
        if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid artifact digest");
        return [file, hash];
      })),
    };
  });
  if (new Set(cases.map((row) => row.id)).size !== cases.length ||
      !cases.some((row) => row.currentDir === baseline && row.expected === "clean")) {
    throw new Error("Suite needs unique case IDs and a clean reference case");
  }
  async function assertUnchanged() {
    if (sha(await readFile(path)) !== sha(bytes)) throw new Error("Suite changed during evaluation");
    for (const row of cases) {
      for (const file of files) {
        if (sha(await readFile(join(row.currentDir, file))) !== row.hashes[file]) {
          throw new Error("Artifact changed since capture");
        }
      }
    }
  }
  await assertUnchanged();
  return { sha256: sha(bytes), cases, assertUnchanged };
}
