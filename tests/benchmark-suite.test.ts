import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadBenchmarkSuite } from "../src/benchmark-suite.ts";

test("a suite rejects changed evidence, unfinished captures, and inconsistent labels", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bg-suite-"));
  try {
    const files = ["evidence.json", "database-before.json", "database-after.json"];
    await Promise.all(files.map((file) => writeFile(join(dir, file), "{}")));
    const sha = createHash("sha256").update("{}").digest("hex");
    const row = { id: "clean-control", expected: "clean", currentDir: dir, baselineDir: dir,
      validation: { experiment_valid: true, upstream_test_passed: true, application_correct: true },
      provenance: { artifact_sha256: Object.fromEntries(files.map((file) => [file, sha])) } };
    const data = { schema_version: 1, complete: true, baseline: dir, cases: [row] };
    const path = join(dir, "suite.json");
    await writeFile(path, JSON.stringify(data));
    const loaded = await loadBenchmarkSuite(path);
    assert.equal(loaded.cases[0].expected, "clean");
    await writeFile(join(dir, "database-after.json"), '{"changed":true}');
    await assert.rejects(loaded.assertUnchanged(), /Artifact changed/);
    await assert.rejects(loadBenchmarkSuite(path), /Artifact changed/);
    await writeFile(join(dir, "database-after.json"), "{}");
    await writeFile(path, JSON.stringify({ ...data, complete: false }));
    await assert.rejects(loadBenchmarkSuite(path), /complete/);
    await writeFile(path, JSON.stringify({ ...data, cases: [{ ...row, expected: "regression" }] }));
    await assert.rejects(loadBenchmarkSuite(path), /ground truth/);
    await writeFile(path, JSON.stringify({ ...data, cases: [row, row] }));
    await assert.rejects(loadBenchmarkSuite(path), /unique case IDs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
