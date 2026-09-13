# A held-out assertion gap, reproduced

Executed 2026-09-12. This is the first case in this project that nobody here
designed. The defect is a real user-reported bug that shipped
([documenso#2485](https://github.com/documenso/documenso/issues/2485), filed
against 2.6.0), the test is the project's own, and the "mutation" is simply the
absence of the upstream fix.

It answers the standing objection to the Linkding suite — that its defects were
written alongside the investigator that finds them.

## What was run

| | |
|---|---|
| Application | `documenso/documenso` |
| Defective build | `3cef238f46ff3a7894f56ce6cd1ac8dd154fe5cf` (the fix's parent) |
| Fixed build | the same tree with only `packages/lib/server-only/template/create-document-from-direct-template.ts` and `packages/lib/server-only/document/send-document.ts` taken from `807d094cf2ca2fc0dfa30150af2c6c7741ce859b` |
| Test | `packages/app-tests/e2e/templates/direct-templates.spec.ts`, the V1 and V2 next-signer-dictation cases, **unmodified in both runs** |
| Stack | Postgres 15, Inbucket, Redis, Playwright 1.56.1, production Remix build |

Only application code differs between the runs. The test file, the seed, the
dependencies and the database schema are identical.

## Result

Both tests passed on both builds, in about the same time.

| | Defective build | Fixed build |
|---|---|---|
| Upstream test | 2 passed (6.8 s) | 2 passed (4.3 s) |
| Recipients at signing order 2 | 4 rows | 4 rows |
| …marked `sendStatus = SENT` | **2** | **0** |
| …carrying a `sentAt` timestamp | **2** | **0** |
| `send.signing.requested.email` jobs | 0 | 0 |
| Emails delivered to those signers | 0 | 0 |
| Rows claiming SENT with no such job | **2** | **0** |

On the defective build the recipient row asserts that a signing request was sent,
with a timestamp, while no job exists that could have sent one and no mail was
delivered. That is a contradiction inside the application's own data — the
plan's regression class C — and the browser test is green over the top of it.
On the fixed build the same row reads `NOT_SENT` and the evidence is internally
consistent.

The pre-existing test loads exactly that row. It ends with a
`prisma.recipient.findMany`, finds the recipient at signing order 2, and asserts
`name` and `email`. It never looks at `sendStatus` or `sentAt`. The fix's own
test addition is an `expectSigningRequestJobForRecipient` helper that requires a
`BackgroundJob` row with `jobId: 'send.signing.requested.email'`.

## What this does not establish

**The missing email is not the differential here.** In this scenario
`sendDocument` throws before queuing anything, because the seeded recipients have
no signature fields, so zero jobs and zero emails appear on *both* builds. The
fix's new test seeds signature fields precisely so the send path completes, which
confirms that the pre-existing test could never have observed the email
consequence. What the old test does expose, and what differs between the builds,
is the false `SENT` claim on the row.

**The filter the fix removed from `send-document.ts` was a no-op.** It was
`recipientsToNotify.filter(...)` with the result discarded. The behavioural
change comes from the two deleted lines in the direct-template path.

**Beyond Green has not investigated this capture.** No Documenso collector
exists yet, so nothing here was normalised into evidence or shown to a model.
This experiment establishes that the gap is real and reproducible; it does not
show that the investigator detects it. That is the next step, and it needs a
collector that records HTTP traffic and snapshots Postgres before teardown, in
the shape [evidence.ts](../../src/investigation/evidence.ts) expects.

**One capture per build, on one machine.** No repetition, no timing claims.

## Why it matters

The Linkding suite demonstrates the mechanism on defects we wrote. This
demonstrates that the mechanism has something real to find: a production bug,
reported by a user, in a project with 129 browser specs, sitting underneath a
test that already held the corrupted row in its hands and checked the wrong two
columns.
