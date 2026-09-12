# Known-bug benchmark candidates: self-hosted productivity and collaboration

Researched 2026-09-12 against public upstream source, GitHub issues, and merged fix
commits. Nothing here was installed, built, seeded, or executed: every finding is a
**source-backed candidate**, never a reproduced gap. Linkding is already in use and
is not re-recommended; Vendure and Twenty are handled in
[benchmark-selection.md](benchmark-selection.md).

Scope of the search: Cal.com, Documenso, Outline, Plane, Focalboard, Wekan, Ghost,
Mealie, paperless-ngx, plus NocoDB as a spot check. Priority order was (1) a
held-out, historically real assertion gap, (2) persisted state or a side effect
rather than a visual glitch, (3) a locally runnable suite with a real backend and a
snapshottable database.

## The second test a candidate gap has to pass

An assertion gap has two independent properties, and most historical gaps have only
the first.

1. **Historical authenticity.** A real bug was fixed, and the same feature already
   had browser coverage. The strongest proof is a fix commit that strengthens an
   assertion inside the pre-existing test, next strongest an issue saying the bug
   shipped, weakest an app-code fix with no test at all.
2. **Trace under the unchanged run.** Beyond Green only sees evidence produced while
   the pre-existing test executes. If the defective write happens on a branch the
   old test never enters (a second reset token, a team admin acting instead of the
   host, an unpaid Stripe session, a recipient added after distribution), then
   reverting the fix changes nothing in the captured evidence and the case is
   undetectable no matter how good the agent is.

Property 2 is an **inference in every row below** and is the first thing the
acceptance gate in [benchmark-selection.md](benchmark-selection.md) should measure.
Findings marked `trace: no` remain useful as authentic bug specifications for
authoring new cases, but they cannot be replayed against the historical test.

Two benchmark shapes follow from this:

- **Historical replay (preferred).** Pin the fix commit's **parent**. The bug is
  authentic, the suite is the real pre-fix suite, and no mutation is hand-written.
  The fix commit is the oracle: applying it should turn the held-out assertion red.
- **Mutation at HEAD.** Pin HEAD and revert the fix hunk. Cheaper to keep current,
  but the strengthened assertion now lives at HEAD and must be held out, which means
  editing a test file, so the "unchanged upstream test" claim weakens.

## Shortlist

| App | Pinned revision | Stack | E2E framework | Database | Best historical gap | Class | Setup | Risks |
|---|---|---|---|---|---|---|---|---|
| **Documenso** (first) | HEAD `5603a9e59da2ae770edcc822ac08a5e3df02ad82`; replay pair `3cef238f46ff3a7894f56ce6cd1ac8dd154fe5cf` → `807d094cf2ca2fc0dfa30150af2c6c7741ce859b` | Remix + tRPC + Prisma (TypeScript) | Playwright, 129 specs in `packages/app-tests/e2e` (29 API-only) | Postgres 15 in Compose | Dictated next signer on a direct template was written `sendStatus = SENT` while no signing-request email job was ever queued ([#2485](https://github.com/documenso/documenso/issues/2485), shipped in 2.6.0) | C (+A) | 30–60 min, Docker | 5 containers incl. a locally built Gotenberg; Konva canvas clicks in V2 specs; `retries: 4`, `maxFailures: 1` under CI |
| **Ghost** (second) | `07671c072c5a5e0538cbe44d9d4ca66111751535` | Node/TypeScript, pnpm + nx | Playwright, 94 specs in `e2e/tests` | MySQL 8 (+ Redis, MailPit) | Gift subscription finalized before the Stripe payment cleared ([PR #30106](https://github.com/TryGhost/Ghost/pull/30106)) | B | 30–60 min cold, Docker | Best gaps cite private Linear tickets, no public issue URLs; all three need a scenario the old flow never entered; monorepo build weight |
| **Cal.com** (third) | `b0a34f21c91ae7803f9b7e2c59c2fbd187cce26f`; full-suite revision `a17f28e9ab44d34a24840cff70082470d775b9b1` | Next.js monorepo + Prisma | Playwright, 53 `*.e2e.ts` in `apps/web/playwright` | Postgres 18 + Mailhog | Webhook/email organizer identity resolved from the acting user instead of the booking host ([PR #20612](https://github.com/calcom/cal.diy/pull/20612)) | C | likely > 30 min | Heaviest install and build; ~40 CI env vars; org/team specs deleted at HEAD; repo renamed to `calcom/cal.diy` |
| **Mealie** (narrow) | `029419e5e6f822c1db55a2dabd5599e0877a7e96` | FastAPI + Nuxt 3 | Playwright, 2 specs / 8 tests in `tests/e2e` (auth only) | SQLite in the app image | OIDC accepted unverified emails and matched into an existing account ([PR #7902](https://github.com/mealie-recipes/mealie/pull/7902)) | E | 20–30 min | Browser coverage is authentication only; `network_mode: host` is awkward on macOS; negative assertions went to pytest |
| paperless-ngx | `72ea38ab126e92fb63d68b7f5d0e6d9abaafe589` | Django + Angular | Playwright, 5 specs | SQLite (live since 2026-08-31) | none found | — | 20–40 min | Every pre-2026-08-31 browser test replayed HAR fixtures with no backend, so there is no historical gap material |
| Outline | `ab40dda96640762d95aad99b5ff0d2ea2b42e562` | Node + Sequelize | none | Postgres 14.2 (server tests) | rejected | — | — | Zero browser/E2E paths in the tree |
| Plane | `2f895b82dad839c730c36a5c0cbc046f1e5d6b56` | Django + Next.js | none | Postgres | rejected | — | — | No browser suite; the pytest suite is not run by any workflow |
| Focalboard | `a84bbb65e32edf972856b329417096ac413518e9` | Go + React | Cypress 9 | SQLite | rejected | — | — | Repository unmaintained, last push 2025-06-11 |
| Wekan | `e7d92a48322d0a14922658dee968e951aad63d56` | Meteor + Mongo | none active | MongoDB | rejected | — | — | Only `playwright.yml.disabled`; Mongo is a poor fit for SQL snapshots |

---

## 1. Documenso — recommended first

### Fitness

Pin `documenso/documenso@5603a9e59da2ae770edcc822ac08a5e3df02ad82`. The browser
suite lives in
[`packages/app-tests/e2e`](https://github.com/documenso/documenso/tree/5603a9e59da2ae770edcc822ac08a5e3df02ad82/packages/app-tests/e2e)
— a tree count at that revision gives **129 `*.spec.ts` files**, of which 29 sit
under `e2e/api` and run without a browser. This is a source count, not a measured
passing count. The
[Playwright configuration](https://github.com/documenso/documenso/blob/5603a9e59da2ae770edcc822ac08a5e3df02ad82/packages/app-tests/playwright.config.ts)
defines three projects (`api`, `license`, `ui`); `ui` runs Desktop Chrome at
1920×1200, with `retries: 4` and `maxFailures: 1` when `CI` is set — both worth
overriding for a benchmark so a run does not abort early.

CI is
[`.github/workflows/e2e-tests.yml`](https://github.com/documenso/documenso/blob/5603a9e59da2ae770edcc822ac08a5e3df02ad82/.github/workflows/e2e-tests.yml)
on every push and PR to `main`: copy `.env.example`, `npm run dx:up`,
`npm run prisma:migrate-dev`, `npm run prisma:seed`, install browsers, then
`npm run ci`. Services come from
[`docker/development/compose.yml`](https://github.com/documenso/documenso/blob/5603a9e59da2ae770edcc822ac08a5e3df02ad82/docker/development/compose.yml):
**postgres:15** on 54320, **inbucket** (SMTP 2500, web 9000), **redis:8**, **minio**,
and **gotenberg** built locally from `Dockerfile.gotenberg`. `npm run ci` is
`turbo run build --filter=@documenso/remix && turbo run test:e2e`, and `test:e2e`
wraps `start-server-and-test` around a real production server plus
`playwright test $E2E_TEST_PATH`, so **a single spec can be run by setting
`E2E_TEST_PATH`** ([root scripts](https://github.com/documenso/documenso/blob/5603a9e59da2ae770edcc822ac08a5e3df02ad82/package.json),
[app-tests scripts](https://github.com/documenso/documenso/blob/5603a9e59da2ae770edcc822ac08a5e3df02ad82/packages/app-tests/package.json)).
CI also sets `NEXT_PRIVATE_SIGNING_LOCAL_FILE_PATH: './example/cert.p12'` and
`DANGEROUS_BYPASS_RATE_LIMITS: 'true'`; a sample certificate is committed at
`apps/remix/example/cert.p12`, so no certificate generation should be needed for the
CI path (confirm on the execution host).

Three properties make Documenso unusually good for Beyond Green:

- Specs already import `@documenso/prisma` and assert on rows, so database evidence
  capture is a natural extension rather than a new mechanism.
- Queued side effects are persisted as `BackgroundJob` rows, so "an email that should
  have been sent was not" is a SQL question, not a log-scraping question.
- Inbucket gives an independent email artifact to cross-check the same claim, which
  is exactly the multi-source contradiction the plan's class C wants.

### Gap D1 — dictated next signer marked SENT with no signing-request email (recommended first case)

**Source-backed candidate.** This is the strongest finding in the whole review because
the pre-existing test already **loaded the very row that the bug corrupted** and
asserted only two of its columns.

- **Issue:** [documenso#2485](https://github.com/documenso/documenso/issues/2485),
  "[Bug]: Email not sending in Direct Template when DICTATE NEXT SIGNER is enabled",
  opened 2026-02-12 against version 2.6.0, closed 2026-05-27. User-visible, shipped,
  reported from production — evidence tier 2.
- **Fix commit:** `807d094cf2ca2fc0dfa30150af2c6c7741ce859b`
  ([PR #2810](https://github.com/documenso/documenso/pull/2810), 2026-05-27). Parent:
  `3cef238f46ff3a7894f56ce6cd1ac8dd154fe5cf`.
- **Pre-existing tests:**
  [`packages/app-tests/e2e/templates/direct-templates.spec.ts#L235`](https://github.com/documenso/documenso/blob/3cef238f46ff3a7894f56ce6cd1ac8dd154fe5cf/packages/app-tests/e2e/templates/direct-templates.spec.ts#L235)
  `[DIRECT_TEMPLATES]: V1 use direct template link with 2 recipients with next signer dictation`
  and the V2 twin at
  [`#L316`](https://github.com/documenso/documenso/blob/3cef238f46ff3a7894f56ce6cd1ac8dd154fe5cf/packages/app-tests/e2e/templates/direct-templates.spec.ts#L316).
- **Assertion that was absent:** the test ends with a `prisma.recipient.findMany`
  and then only
  [`expect(updatedSecondRecipient?.name)` / `expect(updatedSecondRecipient?.email)`](https://github.com/documenso/documenso/blob/3cef238f46ff3a7894f56ce6cd1ac8dd154fe5cf/packages/app-tests/e2e/templates/direct-templates.spec.ts#L312-L313).
  Nothing asserted `sendStatus`, `sentAt`, or any email artifact. The fix added
  `expectSigningRequestJobForRecipient()`, which requires a `BackgroundJob` row with
  `jobId: 'send.signing.requested.email'` and `payload.recipientId` equal to that
  recipient.
- **Wrong persisted state / side effect:** the dictation path in
  `packages/lib/server-only/template/create-document-from-direct-template.ts` wrote
  `sendStatus: SendStatus.SENT, sentAt: new Date()` onto the next recipient; the fix
  deletes exactly those two lines, and also removes a discarded
  `recipientsToNotify.filter(...)` expression in
  `packages/lib/server-only/document/send-document.ts`. The recipient row therefore
  claimed the signing request had been sent while no job existed and the signer never
  received an email. (That the second removed line was a no-op means the precise
  suppression mechanism is **inference** from the diff, not established.)
- **Regression class:** **C, conflicting sources** — the recipient row says SENT, the
  job table and mailbox say nothing was sent. Secondary **A** (a required
  notification silently absent) and **B** (two columns hold a false value).
- **Trace under the unchanged run: likely yes.** The old test proves the dictation
  update ran (it asserts the new name and email landed), and the removed lines were
  part of that same update, so the same run should persist `sendStatus = SENT` with no
  matching job. Unverified.
- **Benchmark shape:** historical replay. Pin the parent, run the V1 spec, capture the
  `Recipient` row, the `BackgroundJob` table, and Inbucket, then apply the fix commit
  to show the held-out assertion turning red.

### Gap D2 — resend emailed the recipient but left `sendStatus = NOT_SENT`

**Source-backed candidate.**

- **Fix commit:** `2f24a8eab25c050855272f513906b371fd3f5a8a`, "fix: set send status on
  resend" ([PR #3011](https://github.com/documenso/documenso/pull/3011), 2026-06-22).
  Parent `d9b772232527808b899adb3c0d1bc2127014cd5c`. No linked issue.
- **Pre-existing test:**
  [`packages/app-tests/e2e/envelope-editor-v2/envelope-actions.spec.ts#L232`](https://github.com/documenso/documenso/blob/d9b772232527808b899adb3c0d1bc2127014cd5c/packages/app-tests/e2e/envelope-editor-v2/envelope-actions.spec.ts#L232)
  `resend document sends reminder`, which drives the real UI resend and asserts the
  "Envelope resent" toast plus a `DocumentAuditLog` row with `type: 'EMAIL_SENT'`,
  `data.isResending === true` and `data.recipientEmail`. A second browser test,
  [`[TEAMS]: resend pending team document`](https://github.com/documenso/documenso/blob/d9b772232527808b899adb3c0d1bc2127014cd5c/packages/app-tests/e2e/teams/team-documents.spec.ts#L224),
  asserts the toast only.
- **Assertion that was absent:** `Recipient.sendStatus` / `sentAt`. The fix added a new
  API-project test, `marks a NOT_SENT signer as SENT after a successful resend`, in
  `packages/app-tests/e2e/api/v2/redistribute-send-status.spec.ts`.
- **Wrong persisted state:** `resend-document.ts` sent the email and wrote the audit
  log while leaving `sendStatus = NOT_SENT`, `sentAt = null`; the fix adds a 13-line
  `prisma.recipient.updateMany` guarded on `sendStatus: NOT_SENT`.
- **Regression class:** **B**, with a strong **C** flavour (audit log says EMAIL_SENT,
  recipient row says NOT_SENT).
- **Trace under the unchanged run: no.** The browser test's recipient is created and
  then distributed by `createPendingEnvelopeViaApi`, so it is already `SENT` and the
  reverted `updateMany` would be a no-op. Making this observable needs a recipient
  added after distribution — a new scenario, which forfeits the held-out property.
  Still the cheapest injection in the repo (13 lines in one server file) if you accept
  authoring the scenario.

### Gap D3 — deleting an account left organisation account rows and never cancelled billing

**Source-backed candidate.**

- **Fix commit:** `8c11266747f5041c27cf2e559890ffb63dac7ad4`, "fix: correctly orphan
  envelopes and stripe cancel on delete"
  ([PR #2967](https://github.com/documenso/documenso/pull/2967), 2026-06-09). Parent
  `3c0345f755851a5dfea8c4f212d43fcb8cc1e119`.
- **Pre-existing test:**
  [`packages/app-tests/e2e/user/delete-account.spec.ts#L8`](https://github.com/documenso/documenso/blob/3c0345f755851a5dfea8c4f212d43fcb8cc1e119/packages/app-tests/e2e/user/delete-account.spec.ts#L8)
  `[USER] delete account` — drives the settings UI and asserts exactly one thing:
  `await expect(getUserByEmail({ email: user.email })).rejects.toThrow()`.
- **Assertions that were absent:** the fix keeps that test verbatim and adds five
  `[USER][DELETE_ACCOUNT]: …` tests asserting envelope re-parenting to the
  deleted-account service user, `organisation`/`team` rows gone, org-linked
  `Account` rows removed, and a `BackgroundJob` for
  `internal.cancel-organisation-subscription`.
- **Wrong persisted state:** `packages/lib/server-only/user/delete-user.ts` only
  orphaned envelopes and relied on the `User` cascade, so owned organisations were
  torn down without removing their `Account` rows and without enqueuing the Stripe
  cancel job — the comment added by the fix says the subscriptions kept billing.
- **Regression class:** **B** (orphan rows) plus **D** (a required background job
  never enqueued).
- **Trace under the unchanged run: unknown.** The new tests create the org-linked
  `Account` row and the `Subscription` themselves, which suggests `seedUser` does not,
  so the minimal pre-existing flow may leave nothing behind. Check what
  `packages/prisma/seed/users.ts` creates before choosing this case.

### Gap D4 — password reset did not invalidate existing sessions

**Source-backed candidate.** Fix `8fca029d961e3ca5661334c0eeb0483e3d62100e`
([PR #2076](https://github.com/documenso/documenso/pull/2076), 2025-12-08), parent
`bac2bf11f415ea8ac44e4716832c5e03440deec9`. The pre-existing spec
[`packages/app-tests/e2e/user/password.spec.ts`](https://github.com/documenso/documenso/blob/bac2bf11f415ea8ac44e4716832c5e03440deec9/packages/app-tests/e2e/user/password.spec.ts#L10)
(`[USER] can reset password via forgot password`, `[USER] can reset password via user
settings`) asserted the `passwordResetToken` row, the success text and a fresh
sign-in, never that an old cookie stopped working. The fix added a `checkSessionValid`
fixture — it did not exist before, so the old tests *could not* have checked this —
plus `[USER] password reset invalidates all sessions` and `[USER] password update
invalidates other sessions but keeps current`. Surviving `Session` rows after a
password rotation is **class E**. **Trace: no** for the pre-existing single-session
flows; a second concurrent session is required, which the old tests never create.

### Gap D5 — unlimited plans recorded no usage at all

**Source-backed candidate, weakest of the set, and the only clean class F.** Fix
`44c4826e92d2ac5124e6072a7418998f20ac4a5d`
([PR #2894](https://github.com/documenso/documenso/pull/2894), 2026-05-31), parent
`61138cdd812f36d553a99871c2a8babf073a0627`. Here the pre-existing tests in
`packages/app-tests/e2e/api/v2/organisation-rate-limits.spec.ts` *encoded the defect*:
`null quota allows unlimited requests` asserted
`expectMonthlyCounter(organisation, 'apiCount', 0)` with a comment saying an unlimited
quota "must never increment the counter". The fix moved the `quota === null` early
return in `packages/lib/server-only/rate-limit/check-monthly-quota.ts` to after the
counter upsert and flipped those expectations. **Trace: yes**, deterministically, at
the parent revision: the suite is green while `OrganisationMonthlyStat` counters stay
at zero for unlimited organisations — **class F, missing telemetry**. Two caveats: it
is arguably a product-semantics change rather than a defect, and these are
API-project tests, so the run is not browser-driven.

---

## 2. Ghost — second

### Fitness

Pin `TryGhost/Ghost@07671c072c5a5e0538cbe44d9d4ca66111751535`. The browser suite is the
repo-root [`e2e/`](https://github.com/TryGhost/Ghost/tree/07671c072c5a5e0538cbe44d9d4ca66111751535/e2e)
package: a tree count gives **94 `*.test.ts` files under `e2e/tests`** (70 admin,
19 public), driven by
[`e2e/playwright.config.mjs`](https://github.com/TryGhost/Ghost/blob/07671c072c5a5e0538cbe44d9d4ca66111751535/e2e/playwright.config.mjs)
against a real Ghost server with **MySQL 8**, Redis, and **MailPit**, brought up by
[`e2e/scripts/infra-up.sh`](https://github.com/TryGhost/Ghost/blob/07671c072c5a5e0538cbe44d9d4ca66111751535/e2e/scripts/infra-up.sh)
(`compose.dev.yaml` plus `e2e/compose.e2e.tmpfs.yaml`). Each test gets a fresh
database restored from a seeded snapshot
([`e2e/helpers/environment/service-managers/mysql-manager.ts`](https://github.com/TryGhost/Ghost/blob/07671c072c5a5e0538cbe44d9d4ca66111751535/e2e/helpers/environment/service-managers/mysql-manager.ts)),
seed data comes from
[`e2e/data-factory`](https://github.com/TryGhost/Ghost/tree/07671c072c5a5e0538cbe44d9d4ca66111751535/e2e/data-factory),
and Stripe is faked in-suite
([`e2e/helpers/services/stripe`](https://github.com/TryGhost/Ghost/tree/07671c072c5a5e0538cbe44d9d4ca66111751535/e2e/helpers/services/stripe)),
so no payment credentials are needed. CI runs the suite as `job_e2e_tests` in
[`.github/workflows/ci.yml`](https://github.com/TryGhost/Ghost/blob/07671c072c5a5e0538cbe44d9d4ca66111751535/.github/workflows/ci.yml)
across 10 main shards plus 2 analytics shards.

MailPit plus a snapshot-restored MySQL is close to an ideal evidence surface for
classes A and C. Two things hold Ghost below Documenso: the interesting fixes cite
private Linear tickets rather than public issues, and all three gaps below need a
scenario the pre-existing flow never entered. Note also that the legacy suite at
`ghost/core/test/e2e-browser` was removed by `9e856dee31` (PR #27038, 2026-03-31), so
pre-2026 findings live on a different harness.

### Gap G1 — gift subscription finalized before the payment cleared

**Source-backed candidate.** Fix `7030d434e150960faf8b9c9811ab3fa8c51e7033`
([PR #30106](https://github.com/TryGhost/Ghost/pull/30106), 2026-08-19; internal
BER-3851, no public issue), parent `0dfe197d5c65328b1eb41035e458a7163a210f54`.
Pre-existing test
[`e2e/tests/public/portal-gifts.test.ts#L10`](https://github.com/TryGhost/Ghost/blob/0dfe197d5c65328b1eb41035e458a7163a210f54/e2e/tests/public/portal-gifts.test.ts#L10)
`a buyer completes a 3-month gift through Stripe checkout` asserted only UI (success
title, `3 months`, a link containing `/gift/`). The fix strengthened that same test
with a gift token from the session metadata plus a real
`GET /members/api/gifts/<token>/redeem/` request. The defect: for delayed payment
methods Stripe can emit `checkout.session.completed` before
`payment_status === 'paid'`, and Ghost finalized the gift anyway while ignoring
`async_payment_succeeded/failed`, so a redeemable gift subscription existed for money
that had not cleared — **class B**. **Trace: no** on the paid happy path; the async
branch needs an unpaid fake session. The async regression coverage went to
`ghost/core/test/e2e-api/members/gift-subscriptions.test.js`, i.e. API level.

### Gap G2 — verification link silently dropped through the signin redirect

**Source-backed candidate.** Fix `5dbfdaf3cd65f27265715af29cf17851eef05762`
([PR #27660](https://github.com/TryGhost/Ghost/pull/27660), 2026-05-06; internal
ONC-1658 from two customer reports), parent
`84954b873e0f88daf0ee11b589bfc8d2eed5add5`; app change is 7 lines in
`ghost/admin/app/services/session.js`. Pre-existing tests
[`e2e/tests/admin/signin.test.ts#L11`](https://github.com/TryGhost/Ghost/blob/84954b873e0f88daf0ee11b589bfc8d2eed5add5/e2e/tests/admin/signin.test.ts#L11)
and `#L25` asserted only that the deep-linked page loaded after signin; the fix added
`query params on a deep link survive signin redirect`, asserting
`expect(page.url()).toContain('verifyEmail=fake-token-xyz')`. Because Ember stripped
`?verifyEmail=<token>` on the redirect replay, the newsletter reply-to address was
never verified — the expected write never landed, **class B**. **Trace: no**: the old
deep links carry no query string.

### Gap G3 — customized welcome-email design not applied to the delivered email

**Source-backed candidate.** Fix `ed152310fd4261735b537be541250bd3e633a810`
([PR #27239](https://github.com/TryGhost/Ghost/pull/27239), 2026-04-08; internal
NY-1217), parent `02ba4c3c481d8421c42ec42e7bf1b7e53133e298`. Pre-existing tests
[`e2e/tests/admin/settings/member-welcome-emails.test.ts#L173`](https://github.com/TryGhost/Ghost/blob/02ba4c3c481d8421c42ec42e7bf1b7e53133e298/e2e/tests/admin/settings/member-welcome-emails.test.ts#L173)
`save design settings - persists to api` and `#L214` stopped at the API response and
the reopened modal. The fix added `customized design is applied to the free member
welcome email`, which signs a member up through Portal and asserts the MailPit HTML
contains the custom footer text and `font-family: Georgia, serif;`. Root cause was a
React Query cache invalidated on the wrong key while the Ember bridge held the other
copy — **class C**. **Trace: no**: the old tests never trigger a member signup, so no
email is delivered during them. Also note the page-object helpers used by the new test
were added in the same commit.

### Material for authored cases, not historical gaps

Ghost has an unusually rich set of persisted-state bugs whose regression tests went to
jsdom, integration, or unit suites rather than the browser suite, so they fail
criterion 1 but are excellent specifications: unsubscribe links affecting the wrong
member when signed in (`733862a46756c3bafd3f1f8f4a600a9a97ec3271`,
[PR #30376](https://github.com/TryGhost/Ghost/pull/30376) — a textbook **class E**),
members removed from all newsletters when unsubscribing from one (`dd6efa9afa`,
[#29605](https://github.com/TryGhost/Ghost/pull/29605)), dropped newsletter recipients
when batch creation is interrupted (`e24e6c0b92`,
[#30230](https://github.com/TryGhost/Ghost/pull/30230)), and a complimentary
subscription created when editing comped members (`5fdccf3400`,
[#28954](https://github.com/TryGhost/Ghost/pull/28954)).

---

## 3. Cal.com — third, richest history, heaviest setup

### Fitness

The repository now resolves as **`calcom/cal.diy`** (old `calcom/cal.com` URLs
redirect). Pin `b0a34f21c91ae7803f9b7e2c59c2fbd187cce26f`; a tree count gives **53
`*.e2e.ts` files** under
[`apps/web/playwright`](https://github.com/calcom/cal.diy/tree/b0a34f21c91ae7803f9b7e2c59c2fbd187cce26f/apps/web/playwright),
with fixtures for users, bookings, orgs, payments, **emails** and **webhooks**. CI is
[`.github/workflows/e2e.yml`](https://github.com/calcom/cal.diy/blob/b0a34f21c91ae7803f9b7e2c59c2fbd187cce26f/.github/workflows/e2e.yml):
service containers **postgres:18** and **mailhog:v1.0.1**, 8 shards, a 20-minute
timeout per shard, and cached database and build steps. Roughly forty `CI_*` secrets
and variables are wired in, most of which a self-hosted run can stub.

Two cautions. First, setup is the heaviest of the four: a large Yarn monorepo,
`prisma generate`, a seeded database, and a Next.js production build; treating this as
a 30-minute setup is optimistic. Second, `ab21c7f805a089fa3a11ffd61c4a9aecc349c16c`
("refactor: Cal.diy", 2026-04-15) **removed the organization and team Playwright
specs**, so several strong historical gaps no longer have their test file at HEAD; use
its parent `a17f28e9ab44d34a24840cff70082470d775b9b1` when you need them. Upstream
also merged `ecc5e66fd4ae7034bb9eaf2fd9f99debb25ddd61`,
"fix(e2e): replace false-passing assertions and hard-coded waits in test suite"
(PR #28486) — a useful independent admission that false-passing assertions exist in
this suite.

### Gap C1 — organizer identity in emitted webhooks is never asserted

**Source-backed candidate.** The clearest documented assertion gap in cal.com, and the
one with the best demo value, because the payload field in question is explicitly
redacted by the test.

- **Fix commit:** `3d02df3b08ffb408baf1a5eead77031bec6ff1fa`, "fix: use correct
  organizer info when admin accepts team booking requiring confirmation"
  ([PR #20612](https://github.com/calcom/cal.diy/pull/20612), 2025-04-09). The PR body
  ticks the "N/A" box for automated tests; the only test change in the whole commit is
  a placeholder rename from `"Unnamed"` to `"Nameless"`. Evidence tier 3 plus a
  one-line touch of the existing assertion.
- **Pre-existing test:**
  [`apps/web/playwright/webhook.e2e.ts#L132`](https://github.com/calcom/cal.diy/blob/b9b12256fab54195366559dd6332721614d2726c/apps/web/playwright/webhook.e2e.ts#L132)
  `BOOKING_REJECTED > can book an event that requires confirmation and then that
  booking can be rejected by organizer`.
- **Assertion that was absent:** the test overwrites
  [`body.payload.organizer.id` and `body.payload.organizer.email` with a redaction
  placeholder](https://github.com/calcom/cal.diy/blob/b9b12256fab54195366559dd6332721614d2726c/apps/web/playwright/webhook.e2e.ts#L170-L171)
  before `toMatchObject`, so **who** the emitted event names as organizer is never
  checked. This is still true at HEAD for all three booking webhook tests
  ([`#L54-L55`](https://github.com/calcom/cal.diy/blob/b0a34f21c91ae7803f9b7e2c59c2fbd187cce26f/apps/web/playwright/webhook.e2e.ts#L54-L55),
  `#L167-L168`, `#L272-L273`).
- **Wrong persisted state / side effect:** `confirm.handler.ts` built the
  `CalendarEvent` organizer from the acting session user rather than
  `booking.user`, so when a team admin confirmed or rejected someone else's booking the
  webhook payload, the attendee emails, and the calendar event all named the wrong
  host, and the organizer's own destination calendar was bypassed. Fixed version at
  HEAD:
  [`confirm.handler.ts#L246-L262`](https://github.com/calcom/cal.diy/blob/b0a34f21c91ae7803f9b7e2c59c2fbd187cce26f/packages/trpc/server/routers/viewer/bookings/confirm.handler.ts#L246-L262).
- **Regression class:** **C**, conflicting sources (`Booking.userId` in the database
  versus the organizer identity in the webhook and email), with **A** for the mail sent
  to the wrong host.
- **Trace under the unchanged run: no.** In the existing single-user test the actor *is*
  the host, so both code versions emit the same identity. A team event where a
  non-host member confirms is required.

### Gap C2 — old password-reset tokens stayed valid

**Source-backed candidate, tier 1.** Fix `613e9f07887a0c77e28acc4c8a7ef6427b4ed328`,
"fix: invalidate old password reset tokens when new one is requested"
([PR #24607](https://github.com/calcom/cal.diy/pull/24607), merged 2025-10-22), parent
`1261247e94b95a3c6f48181028a04b5ad70e51aa`. Before the fix,
[`apps/web/playwright/auth/forgot-password.e2e.ts`](https://github.com/calcom/cal.diy/blob/1261247e94b95a3c6f48181028a04b5ad70e51aa/apps/web/playwright/auth/forgot-password.e2e.ts#L14)
held exactly one test, `Can reset forgotten password`, which already queries
`prisma.resetPasswordRequest`, asserts the new password hash, and asserts that the
*used* link then shows "Whoops". The absent assertion — added by the fix as a second
test in the same file, `Old tokens are invalidated when new reset link is requested` —
is that requesting a second link expires the first row
(`firstRequestAfterSecond.expires <= now`) and that the first link no longer renders the
reset form. The app fix is a `prisma.resetPasswordRequest.updateMany` that expires all
live rows for that email, still present at
[`passwordResetRequest.ts`](https://github.com/calcom/cal.diy/blob/b0a34f21c91ae7803f9b7e2c59c2fbd187cce26f/packages/features/auth/lib/passwordResetRequest.ts#L11-L25).
Class **B**, security-relevant. **Trace: no** — the pre-existing test requests exactly
one reset link, so with the fix reverted the database looks identical. A second request
must be added, which forfeits the held-out property.

### Gap C3 — seated booking rescheduled through the wrong seat reference

**Source-backed candidate.** Fix `bcc433ba9ab233c9555790853111f65858250b15`
([PR #23987](https://github.com/calcom/cal.diy/pull/23987), 2025-09-23) states the
symptom plainly: rescheduling a seated booking from `/upcoming` gave attendees a
"Page not found", and for the host `rescheduleUid` was set to the *first attendee's*
`seatRefUid`. The pre-existing
[`test.describe("Reschedule for booking with seats")`](https://github.com/calcom/cal.diy/blob/2ba571d2305453bf3f8ce4c4f54e6ab0cb8c8602/apps/web/playwright/booking-seats.e2e.ts#L121)
block never clicked Reschedule from the bookings list, and the fix appended 123 lines
of new tests to that same spec. A wrong seat reference is a lost/wrong association
(**class B**), but the added assertions only check the URL, so the demo value is lower
than C1. **Trace: no.**

### Other cal.com leads worth a second look

- `d25130274f3a9655d1ecab5518a4c5d53113487b`, "fix: scope bulk user deletion to
  callers organization" (PR #28872, 2026-04-14): cross-tenant destructive write, app
  code only, no test added — classes **B/E**, but check whether any surviving spec
  covers bulk deletion at HEAD.
- `5e77e34439d64a846f77ad5075abfe9074f1104c`, "fix: users not joining org/team when
  signing up with API v2 invite tokens" (PR #27526): a membership row that was never
  created, with 218 lines added to the pre-existing `signup.e2e.ts` — **class B**.
- `99e71365ab36c49edd507c8e96a30ec7460ed38f`, "fix: Disallow changing username and
  email in case of Organization email invite" (PR #12735, 2023-12-13): the fix added
  `const dbUser = await prisma.user.findUnique(...); expect(dbUser?.username).toBe(...)`
  **inside** the pre-existing step of `organization/organization-invitation.e2e.ts`,
  the best "assertion added to an existing body" example in the repo — but the spec no
  longer exists at HEAD, so it needs the pre-`ab21c7f8` revision.
- `d7c3132fa56d7737f27847ffae0eb0a1b50397bb`, "fix: #10789 Prevent Double Booking (for
  requests that require confirmation)" (PR #10882): two pending bookings for one slot
  could both be confirmed — **class B**; the same commit also fixed a false-passing
  assertion in the existing confirm test by adding a missing navigation.
- `f65c7e413f4ffcad1039304a53b72998d6cb51a0`, "fix: default organizer bug in managed
  event type" (PR #11921): the *added* test asserts only that the success page is
  visible, while the defect was which organizer's conferencing app ends up as the
  booking location — a rare case where the post-fix test would still pass with the
  app fix reverted. Its spec was also removed at HEAD.

---

## 4. Mealie — narrow but cheap

Pin `mealie-recipes/mealie@029419e5e6f822c1db55a2dabd5599e0877a7e96`. There is a real
browser suite, but it is
[`tests/e2e`](https://github.com/mealie-recipes/mealie/tree/029419e5e6f822c1db55a2dabd5599e0877a7e96/tests/e2e)
with only `login.spec.ts` and `oidc-native.spec.ts` — about 8 tests, all
authentication — running against the production Mealie image with a real SQLite
database plus `mock-oauth2-server` and `rroemhild/test-openldap`
([compose](https://github.com/mealie-recipes/mealie/blob/029419e5e6f822c1db55a2dabd5599e0877a7e96/tests/e2e/docker/docker-compose.yml)),
invoked by `.github/workflows/e2e.yml`. Everything else is pytest against the API.

**Gap M1 (source-backed candidate).** Fix
`280cd58b9d5ef83cdf23830eb58146cf0126d4a2`, "fix: harden LDAP and OIDC authentication
providers" ([PR #7902](https://github.com/mealie-recipes/mealie/pull/7902),
2026-07-18): OIDC accepted a self-asserted, unverified email and could match the
session into an existing local or LDAP account, an LDAP bind with an empty password
could succeed anonymously, and an unescaped username could rewrite the LDAP filter.
The telling detail is that the commit's **only** change to the pre-existing browser
spec was adding `"email_verified": true` to five claim fixtures so the existing tests
keep passing — every negative assertion went to
`tests/unit_tests/core/security/providers/test_openid_provider.py` and
`tests/unit_tests/test_security.py`. Wrong owner on a session is **class E** with **B**
secondary. **Trace: partial** — the existing tests exercise the OIDC path, but showing
the takeover needs a second pre-existing account whose email the IdP user claims.

---

## 5. Rejected, with reasons

- **Outline** `ab40dda96640762d95aad99b5ff0d2ea2b42e562`: a tree-wide search for
  `playwright|cypress|puppeteer|selenium` returns **zero paths**, and
  `.github/workflows/ci.yml` runs lint, typecheck and Vitest only (the server shard
  does use a real `postgres:14.2` service, but it is not browser-driven). Fails the
  browser-coverage premise.
- **Plane** `2f895b82dad839c730c36a5c0cbc046f1e5d6b56`: no browser suite, and none of
  the nine workflows runs the `apps/api/plane/tests` pytest suite or provisions a
  database service. Nothing to hold out.
- **paperless-ngx** `72ea38ab126e92fb63d68b7f5d0e6d9abaafe589`: every browser test
  before `4fcd4961bb7f416b511110ed579132f251534a7a` ("change front-end e2e testing to
  a live instance", 2026-08-31) replayed HAR fixtures via `page.routeFromHAR`, so no
  backend and no database existed, and there is no historical gap material. Since that
  commit `src-ui/e2e/backend.py` boots a real disposable Django instance on SQLite,
  but only five specs exist and no fix commits have touched them yet. Usable only for
  authoring new cases.
- **Focalboard** `a84bbb65e32edf972856b329417096ac413518e9`: a real Cypress-against-Go
  suite exists, but the repository is explicitly unmaintained (last push 2025-06-11)
  and pinned to Cypress 9.
- **Wekan** `e7d92a48322d0a14922658dee968e951aad63d56`: the only Playwright workflow is
  `.github/workflows/playwright.yml.disabled`, so nothing browser-driven runs; MongoDB
  also fits the SQL-snapshot evidence design poorly.
- **NocoDB**: a large Playwright suite exists, but it sits outside the productivity and
  collaboration framing already covered by the shortlist and was not investigated
  beyond confirming the suite's existence.

---

## Not verified

Nothing in this document has been executed. To promote any row above from
"source-backed candidate" to a benchmark case, the following must actually be run.

**For every candidate**

1. Install and boot the pinned revision on the execution host; record wall-clock setup
   time against the 30-minute target.
2. Run the named pre-existing test unchanged on the clean application and confirm it
   passes. Report selected-test green separately from full-suite green.
3. Capture HTTP, application-log, and database evidence **before** Playwright and
   framework teardown, and confirm the capture point sees the test database rather than
   a development database.
4. Confirm **property 2, the trace**: with the fix reverted (or at the fix's parent),
   diff the captured evidence against the clean run. If nothing differs, the case is
   not usable as a held-out gap, whatever its history.
5. Confirm no *other* upstream test fails on the reverted code; a candidate is only
   interesting while the suite stays green.
6. Confirm the pre-fix parent commit's CI run was actually green. No per-commit check
   run was fetched for any finding in this document; "the tests passed anyway" is
   currently inferred from the spec file's content at the parent SHA plus the presence
   of a PR-gating E2E workflow.

**Documenso specifically**

- Whether `apps/remix/example/cert.p12` satisfies `NEXT_PRIVATE_SIGNING_LOCAL_FILE_PATH`
  for a local run, or a certificate must be generated.
- Whether the locally built Gotenberg image and MinIO are needed for the specific specs
  chosen, or can be omitted.
- **D1:** that the dictation update at the parent revision really persists
  `sendStatus = SENT` / `sentAt` during the V1 test, and that no
  `send.signing.requested.email` `BackgroundJob` row and no Inbucket message exist for
  that recipient. Also that the V1 spec passes without the signature-field seeding the
  fix later added.
- **D3:** what `packages/prisma/seed/users.ts` and `seedTeam` create, and therefore
  whether `[USER] delete account` leaves any orphan `Account` row at all.
- **D5:** that the parent revision's rate-limit specs pass while
  `OrganisationMonthlyStat` counters stay at zero, and that `DANGEROUS_BYPASS_RATE_LIMITS`
  does not mask the counters.
- Override `retries` and `maxFailures` before drawing conclusions from a run.

**Ghost specifically**

- That `e2e/scripts/infra-up.sh` plus the snapshot restore works on the host, and how
  long a cold Docker image build takes.
- For G1/G2/G3, design the missing scenario (unpaid async Stripe session, deep link
  carrying a query string, member signup after a design change) since none of the three
  is traced by the pre-existing flow; each then becomes an authored case built on an
  authentic bug, not a held-out gap.
- The private Linear tickets behind G1–G3 cannot be cited publicly; if a public issue
  URL is required for the benchmark, prefer Documenso #2485.

**Cal.com specifically**

- Whether a full local install and build is achievable within the setup budget, and
  which `CI_*` variables can be stubbed.
- For C1, whether a team event with a non-host confirmer can be seeded with existing
  fixtures, and whether Mailhog plus the webhook receiver fixture can both be captured
  in one run.
- Whether the pre-`ab21c7f8` revision (`a17f28e9ab44d34a24840cff70082470d775b9b1`)
  still installs cleanly, since the strongest organization-scoped gaps only exist there.

**Mealie specifically**

- Whether `network_mode: host` in the e2e compose file works on the development host.
- Whether a second pre-existing account can be seeded so the OIDC takeover is
  observable through the existing login spec.
