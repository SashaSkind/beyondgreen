import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

test("a fresh checkout regenerates the published findings without private receipts or credentials", async t => {
  const root = await mkdtemp(join(tmpdir(), "provider-report-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  // Copy only versioned inputs and the command's code, never .scratch or .env.
  for (const name of ["scripts/provider-report.ts", "src/investigation/choice-response.ts", "package.json", "docs/experiments/provider-findings"]) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await cp(resolve(name), join(root, name), { recursive: true });
  }
  const output = join(root, "findings-data.js");
  execFileSync(process.execPath, ["scripts/provider-report.ts", "--out", output], {
    cwd: root, env: { ...process.env, TYPESAFE_API_KEY: "", WANDB_API_KEY: "" }, stdio: "pipe",
  });
  assert.equal(await readFile(output, "utf8"), await readFile("site/findings-data.js", "utf8"));
});

test("an altered public receipt is rejected before replacing the findings", async t => {
  const root = await mkdtemp(join(tmpdir(), "provider-report-integrity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp("docs/experiments/provider-findings", root, { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const path = join(root, manifest.files[0].path);
  const receipt = JSON.parse(await readFile(path, "utf8"));
  receipt.summary.correct = 999;
  await writeFile(path, JSON.stringify(receipt));
  const output = join(root, "findings.js");
  await writeFile(output, "previous findings");
  assert.throws(() => execFileSync(process.execPath, ["scripts/provider-report.ts", "--dir", root, "--out", output], { stdio: "pipe" }), /checksum/i);
  assert.equal(await readFile(output, "utf8"), "previous findings");
});
