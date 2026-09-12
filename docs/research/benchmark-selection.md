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
