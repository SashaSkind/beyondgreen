# Benchmark selection

Decision date: 2026-09-12. Three parallel source reviews covered nine products.
Select **Linkding first, Vendure second**, with Twenty reserved for a later
asynchronous-worker benchmark. This is a development sequence, not a claim that
the proposed regressions have been reproduced.

## First: Linkding

Use revision `eb98e67d942436b8ad0207dae5fd99a268463a0b`. Its existing Playwright
browser tests, Django backend, embedded SQLite database, and GitHub Actions E2E
job offer the smallest supported path to a real baseline among our candidates.
The source contains 83 test methods across 15 E2E files; these are not measured
passing-test counts. [Source review and pinned citations](benchmark-lightweight.md)

Start with the existing archive partial-update test. It verifies that the
bookmark disappears from the active list, but not that the archived row remains
in the database. Replacing the archive operation with deletion is the first
candidate mutation. The intended observation is an unchanged passing browser
test plus evidence of lost persisted data. Capture the test database before
Django teardown, and isolate the separate background queue between runs.

## Second: Vendure

Use revision `a9559073e223794f984cc00fed94d04dd50a47cc`. This adds a commerce
domain and a TypeScript backend. Its real dashboard Playwright tests use a
seeded server and embedded sql.js database, although monorepo builds make setup
heavier than Linkding. [Source review and pinned citations](benchmark-commerce.md)

The first candidate is fulfillment succeeding while stock on hand is not
decremented. Its existing fulfillment browser test does not assert inventory.
Verify the selected variant tracks inventory, and export the live database
before teardown; the seed database is not a reliable final-state snapshot.

## Reserve: Twenty

Twenty offers a distinct asynchronous audit-loss scenario, but requires
Postgres, Redis, substantial builds, a seeded workspace, and a worker. Keep it
behind the first two working benchmarks. Its existing QA Scout work must be
acknowledged as adjacent prior art; do not import its agent implementation.
[Source review and pinned citations](benchmark-products.md)

## Acceptance gate

1. Pin the upstream source, tests, dependencies, and seed.
2. Run one unchanged upstream browser test on the clean application.
3. Collect HTTP, application, and database evidence before cleanup.
4. Apply one reversible source mutation and rerun that same test.
5. Accept the case only when the test still passes and independent evidence
   demonstrates the intended defect. Keep mutation labels out of model input.
6. Add clean controls and distinct mutations before widening to a second app.

Report selected-test green separately from full-suite green. Repeated runs
measure stability and do not count as new defects. No application baseline or
mutant has been executed during this research.

## Model readiness

Live synthetic connection checks passed on 2026-09-12 for TypeSafe (resolved
model `jev-1.13.0`) and W&B Inference model
`deepseek-ai/DeepSeek-V4-Pro-0813`. Both returned the expected typed relation
for one simple evidence contradiction. These are connectivity observations,
not detection accuracy or comparative latency results. Repeat with
`npm run models:check`; local receipts are in `.scratch/model-connectivity.json`.

W&B Inference required the explicit project header for
`as-skinderev/beyond-green`; this is configured locally through
`WANDB_INFERENCE_PROJECT`. Pin model versions for the actual evaluation.

The local Docker CLI is installed, but its daemon was not running when checked.
Both initial source-test recipes use embedded databases and can be attempted
natively; browser and language-runtime dependencies still need setup validation.

---

# Second round: held-out historical cases

Decision date: 2026-09-12. Five parallel reviews covered roughly thirty
applications, hunting a different thing from the first round: a *real fixed bug*
whose feature already had passing test coverage, where the fix commit adds the
assertion that was missing. Such a case cannot be accused of having been written
to suit this investigator, which is the standing objection to the Linkding
suite. Domain reviews:
[productivity](benchmark-known-bugs-productivity.md),
[commerce](benchmark-known-bugs-commerce.md),
[developer tooling](benchmark-known-bugs-devtools.md),
[server-rendered](benchmark-known-bugs-server-rendered.md),
[multi-tenant](benchmark-known-bugs-multitenant.md).

Nothing below has been executed. Every case remains a source-backed candidate.

## Two acceptance criteria this round added

**Traceability.** A historical bug and a pre-existing test are not sufficient.
The old test must actually walk the defective path, or the capture contains no
evidence of the defect and there is nothing to investigate. Most gaps fail here:
the broken branch needs a second reset token, a team admin as actor, an unpaid
session, a recipient in another state. Record `trace: yes/no/unknown` per
candidate and reject `no`.

**Authorship.** Two otherwise attractive Zulip fixes carry
`Co-Authored-By: Claude Opus 5 (1M context)`. A fix written by a model is poor
ground truth for evaluating a model-driven investigator, so exclude it. Check
the fix commit's trailers before accepting a case.

## Selection

**Documenso first.** Issue
[#2485](https://github.com/documenso/documenso/issues/2485), user-reported,
shipped in 2.6.0. Replay pair: parent `3cef238f46ff3a7894f56ce6cd1ac8dd154fe5cf`
to fix `807d094cf2ca2fc0dfa30150af2c6c7741ce859b`. With next-signer dictation the
code pre-wrote `sendStatus: SENT, sentAt: now`, so the signing-request email was
never sent while the row claimed it had been. It is the only shortlisted browser
case where the wrong write happens on the flow the existing spec already runs,
and that spec queries the recipient row and asserts `name` and `email` alone. The
fix removes two lines of application code and adds the missing assertion.
Postgres, Inbucket and Playwright; queued side effects are already `BackgroundJob`
rows, which gives a second retrieval source alongside database state.

**Then, by the regression class each adds.** The plan lists six classes; the
Linkding suite reaches only B, plus a cross-owner variant of it.

| Candidate | Adds | Pinned fix | Cost |
|---|---|---|---|
| Documenso #2485 | C, with A and B | `807d094c` | Postgres + Inbucket, browser |
| Gitea #36997 | D and F | `8fdd6d12` | Go, SQLite file, browser and integration suites |
| Directus GHSA-p623-wgx3-wxp8 | E and C | `6d6a7af3` | heavier stack |
| Healthchecks PagerDuty leak | A | `18bd44a6` | cheapest setup; no browser suite |
| Vendure #1250 | B, C and E | `693fd839` | second benchmark, already pinned |

Those four alongside Linkding would cover every class in the plan.

## Vendure: the flagged hedge resolved

[benchmark-commerce.md](benchmark-commerce.md) proposed omitting
`updateStockOnHandForLocation` and correctly warned that the seeded variant must
be confirmed to track inventory. It does not: in
`packages/core/e2e/fixtures/e2e-products-full.csv`, 33 of 34 variants have
`trackInventory=false`, and every order-lifecycle browser test builds its order
via `productVariants(take: 1)`, so `trackInventoryForVariant` skips both stock
updates and the mutation is very likely inert. The commerce review gives three
fixes. Two further constraints: any stock mutation is also caught by the separate
`e2e-sqljs` job, so the benchmark must declare `dashboard-e2e` as its gate; and
the only site unasserted across all 628 monorepo test files is the
`StockMovementEvent` publish.

Vendure is not displaced as the second application. Its own history is the
sharpest illustration of the thesis in this entire review: the stock invariant
broke three times across two major versions, and the test added to catch the
first break asserted `stockOnHand` alone, stayed green through the second, and
the second fix's only test change was adding the `stockAllocated` assertions
that had been missing all along.

## Rejected

Plane and NocoDB have no browser suite at all, and Plane's CI never invokes its
Python tests. Spree has no feature or system specs at its head. Outline,
Focalboard and Wekan were rejected on suite quality, Huly and Sylius on
infrastructure cost. paperless-ngx has the strongest user-reported evidence found
anywhere — restore-from-trash returned 200 and restored the row without
re-indexing it, so the document was back but unfindable — but its dependency
install pulls torch and llama-index and blows the setup budget.
