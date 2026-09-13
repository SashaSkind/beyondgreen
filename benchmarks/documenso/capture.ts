// Capture evidence around one unchanged Documenso browser test.
//
// Unlike Linkding, whose Django test database is destroyed at teardown, the
// Documenso e2e database persists across runs. Snapshots are therefore taken
// immediately before and after the test rather than racing a teardown hook.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const OPERATION = "Create a document from a direct template with a dictated next signer";

function psql(sql: string): unknown {
  const out = execFileSync("docker", [
    "exec", "-i", "database", "psql", "-U", "documenso", "-d", "documenso", "-At", "-c", sql,
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.trim() || "[]");
}

function rows(sql: string): unknown[] {
  const value = psql(`SELECT coalesce(json_agg(t), '[]'::json) FROM (${sql}) t`);
  if (!Array.isArray(value)) throw new Error("Expected a JSON array from psql");
  return value;
}

// Only the columns the contract speaks about. Tokens and auth options stay out.
const RECIPIENTS = `
  SELECT r.id, r."envelopeId", r.email, r.name, r."signingOrder" AS signing_order,
         r.role::text AS role, r."sendStatus"::text AS send_status,
         (r."sentAt" IS NOT NULL) AS has_sent_at,
         r."signingStatus"::text AS signing_status
    FROM "Recipient" r ORDER BY r.id`;

const JOBS = `
  SELECT j.id, j."jobId" AS job_id, j.status::text AS status,
         (j.payload ->> 'recipientId')::int AS recipient_id
    FROM "BackgroundJob" j ORDER BY j."submittedAt"`;

async function mailboxCounts(emails: string[]) {
  const counts: { mailbox: string; email: string; messages: number }[] = [];
  for (const email of [...new Set(emails)]) {
    const mailbox = email.split("@")[0];
    try {
      const response = await fetch(`http://localhost:9000/api/v1/mailbox/${encodeURIComponent(mailbox)}`);
      const body: unknown = response.ok ? await response.json() : [];
      counts.push({ mailbox, email, messages: Array.isArray(body) ? body.length : 0 });
    } catch {
      throw new Error(`Unable to read the mail server for ${mailbox}`);
    }
  }
  return counts.sort((a, b) => a.mailbox.localeCompare(b.mailbox));
}

function snapshot() {
  return { recipients: rows(RECIPIENTS), background_jobs: rows(JOBS) };
}

async function main() {
  const { values } = parseArgs({ options: {
    app: { type: "string" }, out: { type: "string" }, grep: { type: "string", default: "dictation" },
    spec: { type: "string", default: "e2e/templates/direct-templates.spec.ts" },
  } });
  if (!values.app || !values.out) throw new Error("usage");
  const app = resolve(values.app);
  const directory = resolve(values.out);
  mkdirSync(directory, { recursive: true });

  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: app, encoding: "utf8" }).trim();
  // Only the files carrying the defect, so build artefacts such as compiled
  // translations cannot masquerade as an application change.
  const watched = [
    "packages/lib/server-only/template/create-document-from-direct-template.ts",
    "packages/lib/server-only/document/send-document.ts",
    "packages/app-tests/e2e/templates/direct-templates.spec.ts",
  ];
  const dirty = execFileSync("git", ["status", "--short", "--", ...watched], { cwd: app, encoding: "utf8" }).trim();
  const testModified = dirty.split("\n").some((line) => line.includes("direct-templates.spec.ts"));
  if (testModified) throw new Error("The upstream test file has been modified; the claim requires it unchanged");

  const before = snapshot();

  let exitStatus = 0;
  let output = "";
  try {
    output = execFileSync("npm", ["run", "test:e2e", "-w", "@documenso/app-tests"], {
      cwd: app, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        E2E_TEST_PATH: `${values.spec} --grep=${values.grep} --project=ui --workers=1`,
        NEXT_PRIVATE_SIGNING_LOCAL_FILE_PATH: "./example/cert.p12",
        DANGEROUS_BYPASS_RATE_LIMITS: "true",
      },
    });
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    exitStatus = failure.status ?? 1;
    output = failure.stdout ?? "";
  }

  const after = snapshot();
  const passedLine = /(\d+) passed/.exec(output);
  const failedLine = /(\d+) failed/.exec(output);
  const testsPassed = Number(passedLine?.[1] ?? 0);

  // Recipients created by this run only, so accumulated history never counts.
  const beforeIds = new Set((before.recipients as { id: number }[]).map((row) => row.id));
  const created = (after.recipients as { id: number; email: string }[]).filter((row) => !beforeIds.has(row.id));
  const mail = await mailboxCounts(created.map((row) => row.email));

  writeFileSync(join(directory, "database-before.json"), JSON.stringify(before, null, 2) + "\n");
  writeFileSync(join(directory, "database-after.json"), JSON.stringify({ ...after, delivered_mail: mail }, null, 2) + "\n");
  writeFileSync(join(directory, "test-output.log"), output);
  writeFileSync(join(directory, "evidence.json"), JSON.stringify({
    schema_version: 1,
    application: "documenso",
    revision,
    application_code_modified: dirty.length > 0,
    operation: OPERATION,
    test: {
      spec: values.spec, grep: values.grep,
      passed: testsPassed, failed: Number(failedLine?.[1] ?? 0),
      exit_status: exitStatus,
    },
    counts: {
      recipients_before: (before.recipients as unknown[]).length,
      recipients_after: (after.recipients as unknown[]).length,
      recipients_created: created.length,
    },
  }, null, 2) + "\n");

  console.log(`Captured ${created.length} new recipients, ${testsPassed} passing test(s) -> ${directory}`);
  if (exitStatus !== 0 || testsPassed === 0) {
    throw new Error("The upstream test did not pass; this capture cannot support a green-test claim");
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error && error.message === "usage"
    ? "Usage: node benchmarks/documenso/capture.ts --app <documenso-checkout> --out <run-dir> [--grep dictation]"
    : `Capture failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
