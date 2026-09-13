import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { EvidenceSource, Json } from "./types.ts";

// The contract below is the behaviour upstream itself settled on when it fixed
// documenso#2485. It is cited rather than invented here.
const SOURCE = "https://github.com/documenso/documenso/commit/807d094cf2ca2fc0dfa30150af2c6c7741ce859b";
// Relative to packages/app-tests, which is how Playwright is invoked.
const SPEC = "e2e/templates/direct-templates.spec.ts";
const SIGNING_REQUEST_JOB = "send.signing.requested.email";

type ObjectValue = Record<string, unknown>;
type Recipient = {
  id: number; email: string; name: string; signing_order: number | null; role: string;
  send_status: string; has_sent_at: boolean; signing_status: string;
};
type BackgroundJob = { id: string; job_id: string; status: string; recipient_id: number | null };
type Mail = { mailbox: string; email: string; messages: number };

function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid Documenso evidence: ${message}`);
}

function object(value: unknown): ObjectValue {
  requireValid(value !== null && typeof value === "object" && !Array.isArray(value), "expected an object");
  return value as ObjectValue;
}

function array(value: unknown): unknown[] {
  requireValid(Array.isArray(value), "expected an array");
  return value;
}

function integer(value: unknown, minimum = 0): number {
  requireValid(typeof value === "number" && Number.isSafeInteger(value) && value >= minimum, "invalid integer");
  return value;
}

function string(value: unknown): string {
  requireValid(typeof value === "string", "expected a string");
  return value;
}

function boolean(value: unknown): boolean {
  requireValid(typeof value === "boolean", "expected a boolean");
  return value;
}

// Errors deliberately omit local paths and raw rows.
async function readArtifact(directory: string, name: "evidence.json" | "database-before.json" | "database-after.json"): Promise<ObjectValue> {
  try {
    const path = join(directory, name);
    requireValid((await stat(path)).size <= 16 * 1024 * 1024, "artifact exceeds size limit");
    return object(JSON.parse(await readFile(path, "utf8")));
  } catch {
    throw new Error(`Unable to read valid Documenso ${name}`);
  }
}

function recipients(value: unknown): Recipient[] {
  return array(value).map((entry) => {
    const row = object(entry);
    return {
      id: integer(row.id, 1), email: string(row.email), name: string(row.name ?? ""),
      signing_order: row.signing_order === null ? null : integer(row.signing_order, 0),
      role: string(row.role), send_status: string(row.send_status),
      has_sent_at: boolean(row.has_sent_at), signing_status: string(row.signing_status),
    };
  });
}

function jobs(value: unknown): BackgroundJob[] {
  return array(value).map((entry) => {
    const row = object(entry);
    return {
      id: string(row.id), job_id: string(row.job_id), status: string(row.status),
      recipient_id: row.recipient_id === null ? null : integer(row.recipient_id, 1),
    };
  });
}

async function readSummary(directory: string) {
  const data = await readArtifact(directory, "evidence.json");
  requireValid(data.schema_version === 1 && data.application === "documenso", "unsupported artifact");
  const test = object(data.test);
  requireValid(test.exit_status === 0 && integer(test.passed, 1) >= 1 && test.failed === 0,
    "the upstream test did not pass");
  requireValid(string(test.spec) === SPEC, "unexpected test spec");
  return {
    operation: string(data.operation),
    revision: string(data.revision),
    passed: integer(test.passed, 1),
    counts: object(data.counts),
  };
}

// Only rows this run created, so history accumulated in a persistent database
// never reaches the model.
async function delta(directory: string) {
  const before = await readArtifact(directory, "database-before.json");
  const after = await readArtifact(directory, "database-after.json");
  const beforeRecipients = new Set(recipients(before.recipients).map((row) => row.id));
  const beforeJobs = new Set(jobs(before.background_jobs).map((row) => row.id));
  const created = recipients(after.recipients).filter((row) => !beforeRecipients.has(row.id));
  const queued = jobs(after.background_jobs).filter((row) => !beforeJobs.has(row.id));
  requireValid(created.length > 0, "the run created no recipients");
  const mail: Mail[] = array(after.delivered_mail ?? []).map((entry) => {
    const row = object(entry);
    return { mailbox: string(row.mailbox), email: string(row.email), messages: integer(row.messages) };
  });
  return { created, queued, mail };
}

function signingRequestFor(queued: BackgroundJob[], recipientId: number): boolean {
  return queued.some((job) => job.job_id === SIGNING_REQUEST_JOB && job.recipient_id === recipientId);
}

// A passing browser test is insufficient to establish reference correctness.
// This gate validates only the supplied reference, never the run under review.
function validateKnownGood(state: Awaited<ReturnType<typeof delta>>): void {
  for (const recipient of state.created) {
    // A recipient who signs through the direct link is marked SENT without a
    // sentAt, because nothing was ever dispatched to them. The timestamp is the
    // claim that a request went out, so only it demands a matching job.
    if (!recipient.has_sent_at) continue;
    requireValid(signingRequestFor(state.queued, recipient.id),
      "known-good run timestamped a dispatch with no signing request queued");
  }
}

export async function loadDocumensoEvidence(currentDir: string, baselineDir: string): Promise<EvidenceSource> {
  const current = await readSummary(currentDir);
  return {
    initial: {
      test: { passed: true, count: current.passed, scenario: "Sign a direct template that dictates the next signer" },
      operation: current.operation,
      counts: { recipients_created: integer(current.counts.recipients_created, 1) },
    },
    catalog: {
      database_state: "Recipient rows this run created and the background jobs it queued.",
      operation_contract: "Pinned upstream behaviour for this operation and the state it must leave behind.",
      delivered_mail: "Messages the mail server actually received for the recipients this run created.",
      known_good_run: "The same observations from a supplied known-good run.",
    },
    required: ["database_state", "operation_contract"],
    async retrieve(key): Promise<Json> {
      switch (key) {
        case "database_state": {
          const { created, queued } = await delta(currentDir);
          return { recipients_created: created, background_jobs_queued: queued } as Json;
        }
        case "delivered_mail": {
          const { mail } = await delta(currentDir);
          return { mailboxes: mail } as Json;
        }
        case "operation_contract": return {
          operation: "Create a document from a direct template with a dictated next signer",
          requirements: [
            "Create the document's recipients from the template, preserving each recipient's role and signing order.",
            "Apply the dictated signer's name and email to the next recipient in the signing order.",
            `A recipient's sentAt timestamp asserts that a signing request was dispatched to them. Set it only when such a request has been queued, recorded as a background job with jobId '${SIGNING_REQUEST_JOB}' whose payload recipientId is that recipient.`,
            "A recipient who signs through the direct link is marked SENT with no sentAt timestamp and no queued request, because nothing was dispatched to them. That combination is correct and is not a defect.",
            "Leave a recipient who has neither signed nor been dispatched to as NOT_SENT with no sentAt timestamp.",
          ],
          source: {
            citation: SOURCE,
            function: "createDocumentFromDirectTemplate",
            implementation: "Updates the next recipient's dictated name and email without asserting a send status; the send status is set by the code path that actually dispatches the request.",
          },
        };
        case "known_good_run": {
          const baseline = await readSummary(baselineDir);
          const state = await delta(baselineDir);
          validateKnownGood(state);
          return {
            operation: baseline.operation,
            recipients_created: state.created,
            background_jobs_queued: state.queued,
            delivered_mail: state.mail,
          } as Json;
        }
        default: throw new Error("Unknown evidence key");
      }
    },
  };
}
