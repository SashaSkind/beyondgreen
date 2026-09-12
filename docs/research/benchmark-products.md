# Collaboration products for the Beyond Green benchmark

Research date: 2026-09-12. Scope: Plane, Outline, and Twenty CRM. This is source inspection only: no app was installed and no baseline or mutant was run. A plausible unasserted regression is not yet a demonstrated green mutant.

## Recommendation

Of these three, **Twenty is the only candidate with a verified existing public Playwright browser suite and a corresponding GitHub Actions job**. Keep it as a substantial second benchmark, or choose it first only if the infrastructure is already available. Plane and Outline fail the existing-browser-E2E selection gate at the inspected revisions. Do not spend the hackathon writing new browser tests to make them qualify.

Practical ranking within this shortlist:

1. **Twenty:** strongest evidence and a concrete missing audit-history mutation; high setup burden.
2. **Plane:** real product and rich asynchronous backend, but no browser E2E suite found; high setup burden.
3. **Outline:** attractive Node/Postgres backend, but no browser E2E suite found and its current manifest declares Business Source License 1.1 rather than an open-source license.

The immutable sources and limitations behind those conclusions follow.

## Twenty CRM

Pin: [`b782836bca6841bf735026d2223bbb22a65019a6`](https://github.com/twentyhq/twenty/tree/b782836bca6841bf735026d2223bbb22a65019a6).

The project declares AGPL-3.0, Node `^24.5.0`, and Yarn 4.13.0. It is an Nx monorepo. [Manifest](https://github.com/twentyhq/twenty/blob/b782836bca6841bf735026d2223bbb22a65019a6/package.json)

### Exact existing test and assertion gap

[`packages/twenty-e2e-testing/tests/create-record.spec.ts`](https://github.com/twentyhq/twenty/blob/b782836bca6841bf735026d2223bbb22a65019a6/packages/twenty-e2e-testing/tests/create-record.spec.ts) contains `Create and update record`. It creates John Doe, edits email, intro, LinkedIn URL, rating, phone, and work preference, expands the record, extracts the person UUID from the URL, and then requests the person through GraphQL. The final assertions check persisted first/last name, email, intro, LinkedIn URL, phone, and work preference. It never queries or asserts timeline/audit activity. The test even selects `performanceRating` in its query without asserting it, but a stable backend rating-mutation site was not established in this research.

The screenshot fixture captures a screenshot after each test; it is not an image-comparison assertion. Thus a missing timeline entry is not implicitly verified by that fixture. [Fixture](https://github.com/twentyhq/twenty/blob/b782836bca6841bf735026d2223bbb22a65019a6/packages/twenty-e2e-testing/lib/fixtures/screenshot.ts)

### First proposed mutation

In [`UpsertTimelineActivityFromInternalEvent.handle`](https://github.com/twentyhq/twenty/blob/b782836bca6841bf735026d2223bbb22a65019a6/packages/twenty-server/src/modules/timeline/jobs/upsert-timeline-activity-from-internal-event.job.ts), add a narrow early return for `workspaceEventBatch.name === 'person.updated'`. This job runs on `entityEventsToDbQueue`; its normal action invokes `TimelineActivityService.upsertEvents` inside the event's workspace context.

This is an **injected asynchronous audit-loss defect**, not a claim of an existing upstream bug. The browser/API assertions should still pass because they verify the person record, while the mutated job only skips timeline persistence. That expectation remains an inference until the unmodified test passes on both revisions.

The normal [timeline service](https://github.com/twentyhq/twenty/blob/b782836bca6841bf735026d2223bbb22a65019a6/packages/twenty-server/src/modules/timeline/services/timeline-activity.service.ts) converts update events into payloads, preserving their diffs, and calls the [timeline repository](https://github.com/twentyhq/twenty/blob/b782836bca6841bf735026d2223bbb22a65019a6/packages/twenty-server/src/modules/timeline/repositories/timeline-activity.repository.ts) to write `timelineActivity` records. The [self-rule builder](https://github.com/twentyhq/twenty/blob/b782836bca6841bf735026d2223bbb22a65019a6/packages/twenty-server/src/modules/timeline/utils/build-timeline-activity-self-rule.util.ts) includes update activity for audited, non-system objects. Confirm the seeded person's object metadata meets that condition before labeling the sample.

Evidence to collect:

- Unmodified Playwright result and person UUID from network traffic/test output.
- Successful GraphQL responses and final person row.
- That person's timeline rows and update diffs, in the correct workspace schema.
- Worker queue status and logs, including enough observation time to rule out normal queue lag.
- Known-good timeline result from the same pinned revision and seed.
- Relevant audit configuration and source-derived requirement.

Do **not** require one timeline row per UI edit: the repository deliberately merges recent activity within a ten-minute window. Compare the expected changed-field diffs and associated person, not a simplistic row count. For a fair paired run, reset/isolate database and Redis state, preserve the same collector on clean/mutant runs, and take the database snapshot after a bounded queue-settling check. Never delete rows after the test to fabricate evidence.

### Reproducible setup and burden

The [existing E2E workflow](https://github.com/twentyhq/twenty/blob/b782836bca6841bf735026d2223bbb22a65019a6/.github/workflows/ci-e2e-main.yaml) supplies Postgres 18 and Redis, installs dependencies and browsers, builds shared/frontend/server packages, resets E2E environment files, creates databases, runs `twenty-server:database:reset`, serves the built frontend from the server, starts the server and a separate worker, then runs `npx nx test twenty-e2e-testing`. It captures server/worker logs. Adapt this deterministic portion, not the entire workflow.

The [E2E README](https://github.com/twentyhq/twenty/blob/b782836bca6841bf735026d2223bbb22a65019a6/packages/twenty-e2e-testing/README.md) documents selecting one file: `npx nx test twenty-e2e-testing tests/create-record.spec.ts`. [Playwright config](https://github.com/twentyhq/twenty/blob/b782836bca6841bf735026d2223bbb22a65019a6/packages/twenty-e2e-testing/playwright.config.ts) uses one worker, a login dependency, and failure-only traces; Beyond Green should enable traces/network capture for passing tests through a harness configuration. [Login setup](https://github.com/twentyhq/twenty/blob/b782836bca6841bf735026d2223bbb22a65019a6/packages/twenty-e2e-testing/tests/login.setup.ts) needs seeded credentials and the Apple workspace. Be careful about origin/subdomain handling; the CI deliberately serves frontend and backend from one origin.

Burden assessment: high relative to a small Node app. Two data services, source builds, seeded workspace metadata, browser auth, and an asynchronous worker all need to work before a valid baseline exists. No measured setup time, RAM requirement, or test pass rate is asserted here.

### Existing upstream agent work

The same [CI workflow](https://github.com/twentyhq/twenty/blob/b782836bca6841bf735026d2223bbb22a65019a6/.github/workflows/ci-e2e-main.yaml) already has a QA Scout stage after deterministic tests. Its comments describe an agent deriving scenarios from a merged PR, driving the browser, and inspecting server/worker logs. This is relevant adjacent prior art. Keep upstream application/tests as the benchmark dependency; do not adopt its agent implementation as hackathon-created Beyond Green code or imply this app has never had post-test AI investigation.

## Plane

Pin: [`2f895b82dad839c730c36a5c0cbc046f1e5d6b56`](https://github.com/makeplane/plane/tree/2f895b82dad839c730c36a5c0cbc046f1e5d6b56), branch `preview` when inspected.

The full recursive repository tree was inspected for `playwright`, `cypress`, and `e2e` paths; none were returned. This is a negative finding about the inspected public tree, not proof that Plane has no private or historical browser tests. Its [root manifest](https://github.com/makeplane/plane/blob/2f895b82dad839c730c36a5c0cbc046f1e5d6b56/package.json) exposes build/dev/check scripts rather than browser test commands; its [API workflow](https://github.com/makeplane/plane/blob/2f895b82dad839c730c36a5c0cbc046f1e5d6b56/.github/workflows/pull-request-build-lint-api.yml) installs Python API dependencies and runs Ruff.

The [local Compose file](https://github.com/makeplane/plane/blob/2f895b82dad839c730c36a5c0cbc046f1e5d6b56/docker-compose-local.yml) includes Postgres, Valkey, RabbitMQ, MinIO, the Python API, worker, beat worker, and migrator. Those are rich evidence sources, but they create meaningful startup burden. Its manifest declares AGPL-3.0 and Node >=22.22.0. Since no qualifying browser test was found, there is no evidence-backed mutation/test pair to recommend. Stop here unless another researcher supplies an exact public suite.

## Outline

Pin: [`ab40dda96640762d95aad99b5ff0d2ea2b42e562`](https://github.com/outline/outline/tree/ab40dda96640762d95aad99b5ff0d2ea2b42e562).

The full recursive tree likewise returned no `playwright`, `cypress`, or `e2e` paths. The [manifest](https://github.com/outline/outline/blob/ab40dda96640762d95aad99b5ff0d2ea2b42e562/package.json) uses Vitest app/shared/server projects; the [CI workflow](https://github.com/outline/outline/blob/ab40dda96640762d95aad99b5ff0d2ea2b42e562/.github/workflows/ci.yml) runs those tests and supplies Postgres for server tests. It has real database-backed server tests, but that is not the requested existing browser-E2E benchmark.

The manifest also declares Business Source License 1.1, so describe the current product as source-available if referenced; it is a poor match to the plan's open-source preference. No runtime was attempted and no qualifying browser test/mutation pair was identified. Do not select it merely because it has abundant `.test.ts` files.

## Acceptance gate before implementation

For any selected app, preserve the exact upstream E2E assertions and pin application/test revisions. First establish a clean passing baseline with evidence, then apply one reversible source mutation and rerun. Promote the candidate only after the unchanged E2E test is green and the independently collected evidence demonstrates the intended hidden defect. Neither the source reasoning in this document nor a synthetic evidence fixture substitutes for that run.
