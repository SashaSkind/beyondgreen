# Developer-tooling benchmark candidates: held-out historical assertion gaps

Researched 2026-09-12 against public upstream source and issue trackers. Domain:
git forges, issue trackers, and CI systems. This is a static source and history
inspection. **None of these applications was installed, built, or run, and no
regression below has been reproduced.** Every finding is labelled a
**source-backed candidate**: the citation chain is verified, the runtime
behaviour is not.

Linkding is already in use and is deliberately not re-recommended here; see
[benchmark-selection.md](benchmark-selection.md). Twenty remains reserved.

## What counts as a finding here

Priority 1 is a *held-out, historically real* assertion gap: a **fixed** bug
whose feature **already had** E2E/browser or integration coverage that passed
anyway. The strongest evidence is a fix commit that changes application code and
**adds or strengthens an assertion in a test file that already existed for that
same feature** — the added assertion is documentary proof the old one was
missing, and it doubles as a ready-made ground-truth oracle.

That structure gives the benchmark a clean mutation recipe:

```text
revert the fix hunk in application code
hold out the assertion the fix added   (ground truth oracle)
run the pre-existing test unchanged    (expected: still green)
Beyond Green investigates the evidence (expected: regression found)
```

The held-out upstream assertion means the expected label is not our invention.

## Shortlist

| App | Pinned revision | Stack | E2E framework | Database | Best historical gap | Class | Setup cost | Risks |
|---|---|---|---|---|---|---|---|---|
| **Gitea** | `1280de570485ac5dfe8c644564990d8175c8f043` | Go 1.27 + Vue | Playwright 1.62.1 (`tests/e2e`, 51 cases) **and** Go integration (`tests/integration`, 723 funcs) | SQLite3 file, per-run temp dir | `workflow_run` webhook dropped for all but the first run when a **background cron** reaps tasks (#36997) | **D + F** | ~20–30 min; no Docker on macOS | Actions cron timing; audit subsystem is one day old |
| **Forgejo** | `e58c82f6de4fe6ecb21c526802827a07e8d64118` | Go 1.26 + Vue | Playwright 1.62.1 (`tests/e2e`, 63 specs) **and** Go integration (375 files) | SQLite3 file | PR review dismissal **never wrote an activity row** for ~3 years while its API test passed (#8853) | **F** | ~20–40 min | Codeberg-hosted (no `gh`); Forgejo Actions; PR Playwright run is label-gated |
| **Woodpecker CI** | `389b8e57e32b8d70a42669835f5e5017929a2763` | Go 1.26 + Vue | Go `e2e/scenarios` (14 funcs, scheduling only) | SQLite **`:memory:`** in E2E | Repo delete orphaned pipeline/step rows via an advancing delete offset (#6970) | **B** | ~5–10 min | E2E suite is narrow; in-memory DB blocks file snapshots |
| **Zulip** | `675c8cf9927e48b922afd4dd31dad68bb505928f` | Django/Python + TS | Puppeteer (`web/e2e-tests`, 20 smoke cases) **and** Django `zerver/tests` (4,118 funcs) | PostgreSQL only (+pgroonga) | GitHub webhook posted a **duplicate** review message, both 200, for 11 months (#26145) | **A** | ~40–75 min, Vagrant + Docker on macOS | Over setup budget; no SQLite; **prior-work contamination in audit-log commits** |
| **Huly** | `63e28dc96483967b2fc21c881b3f1023c1de7718` | TS monorepo, ~20 services | Playwright (`tests/sanity`, 215 cases) | Mongo + Cockroach + Postgres + Kafka + MinIO + ES | none found | — | Well over budget; ~16 containers | Weak issue hygiene, so the fix-commit mining technique yields little |
| **Plane** | `2f895b82dad839c730c36a5c0cbc046f1e5d6b56` | Next.js + Django | **none** | PostgreSQL | n/a | — | n/a | **Disqualified** |

## Recommendation

**Gitea first, Forgejo immediately second.**

Gitea wins on criterion 3 by a clear margin and supplies the only finding that
lands in a class our benchmark does not yet cover at all. Forgejo is the second
app rather than a fallback, because its single best finding is the cleanest
class-F gap in this entire review and its infrastructure is a near-sibling of
Gitea's, so the evidence collector should port with little change.

Classes **D (background failure)** and **F (missing telemetry)** are currently
uncovered by our benchmark. **Gitea #36997 covers both. Forgejo #8853 covers F
outright.** These are the two findings to build first.

Plane is disqualified: it has no browser suite of any kind, and its GitHub
Actions never invoke its pytest suite — the only API PR job runs `ruff`. A
benchmark measuring what CI misses needs a CI that runs tests.

---

# 1. Gitea — primary recommendation

Pin **`go-gitea/gitea@1280de570485ac5dfe8c644564990d8175c8f043`** (2026-09-12).

## Why the infrastructure fits

Gitea is the rare case that satisfies every item in criterion 3 at once, and the
Go + SQLite expectation in the brief is confirmed rather than assumed.

**Two real suites, both run by GitHub Actions on every pull request.**

- Playwright 1.62.1, `testDir: ./tests/e2e/`, projects `chromium` **and**
  `firefox`. Static count: **51 `test(...)` cases across 28 test files** →
  ~102 browser runs, comfortably inside the plan's 30–100 target. These are
  source counts, not measured passing counts.
  [playwright.config.ts](https://github.com/go-gitea/gitea/blob/1280de570485ac5dfe8c644564990d8175c8f043/playwright.config.ts),
  [tests/e2e](https://github.com/go-gitea/gitea/tree/1280de570485ac5dfe8c644564990d8175c8f043/tests/e2e)
- Go integration suite: **723 `func Test…` across 261 files** in
  `tests/integration`, driving a real HTTP server, real git repositories, and a
  real database.
  [tests/integration](https://github.com/go-gitea/gitea/tree/1280de570485ac5dfe8c644564990d8175c8f043/tests/integration)
- CI: `pull-e2e-tests.yml` runs `make test-e2e` on `pull_request`;
  `pull-db-tests.yml` job `test-sqlite` runs
  `GITEA_TEST_DATABASE=sqlite make test-integration`.
  [e2e CI](https://github.com/go-gitea/gitea/blob/1280de570485ac5dfe8c644564990d8175c8f043/.github/workflows/pull-e2e-tests.yml),
  [db CI](https://github.com/go-gitea/gitea/blob/1280de570485ac5dfe8c644564990d8175c8f043/.github/workflows/pull-db-tests.yml)

**The E2E harness already produces exactly the evidence Beyond Green wants.**
`tools/test-e2e.sh` creates a `mktemp -d` work directory, writes its own
`app.ini` with `DB_TYPE = sqlite3` and `PATH = $WORK_DIR/data/gitea.db`, starts
the real server on a free port, redirects output to `$WORK_DIR/server.log`, and
creates an admin user via the CLI. A single SQLite file plus a single log file,
both in a known temp directory, is the smallest possible evidence-capture
problem. **Verified: no container is used on macOS** — `detect_playwright_mode`
only selects container mode on non-Debian-family Linux, so `uname -s = Darwin`
takes the local path and Docker is not required.
[tools/test-e2e.sh](https://github.com/go-gitea/gitea/blob/1280de570485ac5dfe8c644564990d8175c8f043/tools/test-e2e.sh)

**The two suites give complementary evidence surfaces, which is unusually
useful.** The integration suite's config forces synchronous delivery —
`[queue] TYPE = immediate`, plus `immediate` for `webhook_sender`, `push_update`
and `code_indexer` — so webhook effects are deterministic and inline. It also
sets `[mailer] ENABLED = true` with `PROTOCOL = dummy`, giving a captured email
channel for class A. The Playwright harness's generated `app.ini` overrides
*none* of the queue settings, so the E2E instance runs Gitea's real default
`level` queue with 1–10 async workers, and `Actions.Enabled` defaults to `true`,
which means the Actions cron tasks genuinely register and run.
Deterministic evidence in one suite, real background failure surface in the
other.
[tests/sqlite.ini.tmpl](https://github.com/go-gitea/gitea/blob/1280de570485ac5dfe8c644564990d8175c8f043/tests/sqlite.ini.tmpl),
[queue defaults](https://github.com/go-gitea/gitea/blob/1280de570485ac5dfe8c644564990d8175c8f043/modules/setting/queue.go#L31-L45),
[actions defaults](https://github.com/go-gitea/gitea/blob/1280de570485ac5dfe8c644564990d8175c8f043/modules/setting/actions.go#L47)

Toolchain: Go 1.27 (`toolchain go1.27.1`), Node `>= 22.18.0`, `pnpm@12.2.1`,
`@playwright/test` 1.62.1. `make test-e2e` depends on `playwright frontend backend`.

## G1 — `workflow_run` webhook dropped for every run but the first (class D + F)

**This is the strongest finding in the review and the reason to pick Gitea.** It
is simultaneously a background failure and a missing-telemetry failure, the two
classes our benchmark does not cover.

- **Fix commit:** `8fdd6d1235393f6e5cd3027872121a3a9868d3d1`, parent
  `d5a89805d90d31465ac10fdf3d1a9119b669e8be`. PR
  [#36997](https://github.com/go-gitea/gitea/pull/36997) "Fix missing
  `workflow_run` notifications when updating jobs from multiple runs", merged
  2026-03-26.
  [commit](https://github.com/go-gitea/gitea/commit/8fdd6d1235393f6e5cd3027872121a3a9868d3d1)
- **Shape of the fix:** application code +7/−2 in one file, and **+83/−0 of new
  test in a pre-existing test file**. Nothing else. This is the strongest form of
  evidence in the brief's hierarchy.
- **The defect:** in `services/actions/clear_tasks.go`,
  `notifyWorkflowJobStatusUpdate` emitted the per-job notification in a loop but
  emitted the **run-level** notification only once, for `jobs[0]`:
  `if job := jobs[0]; job.Run != nil && job.Run.Repo != nil { notify_service.WorkflowRunStatusUpdate(...) }`.
  When the input jobs spanned several runs, every run except the first was
  silently never announced. The fix collects a `map[int64]*ActionRun` and
  notifies each.
- **Why this is class D.** At the parent commit `notifyWorkflowJobStatusUpdate`
  had seven callers, and three of them are **registered background cron tasks**:
  `stop_zombie_tasks` (`@every 5m`, `RunAtStart: true`), `stop_endless_tasks`
  (`@every 30m`, `RunAtStart: true`) and `cancel_abandoned_jobs` (`@every 6h`,
  `RunAtStart: true`). The reaper updated the database correctly and the
  user-facing run page was accurate; only the outbound notification for the
  other runs vanished. The concurrency callers
  (`CancelPreviousJobs`, `PrepareToStartJobWithConcurrency`,
  `PrepareToStartRunWithConcurrency`) span multiple runs by construction.
  [cron registration](https://github.com/go-gitea/gitea/blob/1280de570485ac5dfe8c644564990d8175c8f043/services/cron/tasks_actions.go#L18-L54)
- **Why this is class F.** The run reached a terminal state in the database while
  the `workflow_run` webhook event never arrived at the receiver — the plan's
  "event sent / event never arrived" shape, with the DB as the source that is
  right and the telemetry as the source that is missing.
- **Pre-existing test that passed:**
  `tests/integration/repo_webhook_test.go` → **`Test_WebhookWorkflowRun`**. At
  the parent commit its table already had six subtests, including
  `WorkflowRunEventsOnCancellingAbandonedRunAllJobsAbandoned` and
  `…PartiallyAbandoned`, which call `actions.CancelAbandonedJobs(ctx)` — the
  very code path that was broken — and assert on the delivered payloads.
- **The specific assertion that was absent:** every pre-existing subtest used a
  **single** workflow run, so `jobs[0]` was coincidentally the only run and the
  bug was invisible. `testWorkflowRunEventsOnCancellingAbandonedRun` asserts
  `assert.Len(t, webhookData.payloads, 2)` — two payloads for *one* run's
  lifecycle (`requested`, then `completed`) — and then indexes `payloads[1]`.
  **No assertion anywhere tied the number of `workflow_run` payloads to the
  number of affected runs, and none checked which run each payload was for.**
  The fix's new subtest `WorkflowRunOnStoppingEndlessTasksForMultipleRuns` adds
  precisely those: `require.Len(t, webhookData.payloads, initialRunEventsLen+2)`,
  then `assert.Contains(t, completedRunIDs, job1.RunID)` and
  `assert.Contains(t, completedRunIDs, job2.RunID)`, having first established
  `require.NotEqual(t, job1.RunID, job2.RunID)`.
- **Ready-made oracle:** hold out that subtest, revert the 7-line hunk, and the
  remaining six subtests are the green suite.
- **Caveat:** there is no user-filed issue. The PR closes nothing and its body
  is the whole narrative. Evidence here is of the "fix strengthens the test"
  kind, not the "users reported it shipped" kind.

## G2 — repository deletion orphaned rows in seven tables (class B)

Strongest *documentary* case in Gitea: a filed issue with a table of affected
models, a fix that closes it, and an explicit upstream statement that the new
test fails on all seven tables without the fix.

- **Issue:** [#38494](https://github.com/go-gitea/gitea/issues/38494) "Seven
  repo-keyed tables are not cleaned up by `DeleteRepositoryDirectly`", closed
  2026-07-24. **Fix:** PR
  [#38534](https://github.com/go-gitea/gitea/pull/38534), commit
  `9ad80e1ebaf3b5598797f103a7b204c71dbbf456` ("Fixes #38494").
  [commit](https://github.com/go-gitea/gitea/commit/9ad80e1ebaf3b5598797f103a7b204c71dbbf456)
- **The defect:** `DeleteRepositoryDirectly`'s `deleteBeans` cascade omitted
  `action_variable`, `action_run_attempt`, `action_tasks_version`,
  `renamed_branch`, `commit_status_summary`, `commit_status_index` and
  `repo_transfer`. Deletion returned success and the repository disappeared from
  the UI while rows outlived it. Gitea has no DB-level `ON DELETE CASCADE`, so
  the Go list is the only cascade. Note `repo_transfer`: a repo-scoped reaper
  `DeleteRepositoryTransfer(ctx, repoID)` already existed and teardown simply
  never called it — the closest thing in this review to the brief's
  "transfer that orphans rows".
- **Pre-existing tests that passed:** `services/repository/delete_test.go` →
  `TestDeleteRepositoryDirectly` and `TestDeleteOwnerRepositoriesDirectly`.
- **The specific assertion that was absent:** neither asserted anything about
  repo-scoped rows in those seven tables. The fix adds
  `TestDeleteRepositoryDirectlyPurgesRepoScopedRows`, which inserts one row per
  table, deletes repo 1, and then makes seven `unittest.AssertNotExistsBean`
  assertions. The PR states plainly: "Without the fix it fails on all seven
  tables."
- **Honest weakness:** this is a service-level test using real DB fixtures, not
  a browser or HTTP integration test. Repository deletion appears in
  `tests/integration` only as cleanup (`repo_test.go:649`,
  `api_repo_test.go:570`), so the *browser-level* claim is unproven. Symptom is
  unbounded table growth, not disclosure — the issue says so explicitly.

## G3 — non-owner could change repository team access (class B, with read impact)

- **Fix:** PR [#39046](https://github.com/go-gitea/gitea/pull/39046)
  "fix(repo): require organization owners for team access", commit
  `204c0bafd358d69d7d1a565a89d4f16b440efda4` (2026-08-23).
  [commit](https://github.com/go-gitea/gitea/commit/204c0bafd358d69d7d1a565a89d4f16b440efda4)
- **The defect:** both the API (`routers/api/v1/repo/teams.go`) and the web
  handler (`routers/web/repo/setting/collaboration.go`) gated on
  `!ctx.Repo.Owner.RepoAdminChangeTeamAccess && !ctx.Repo.Permission.IsOwner()`.
  `Permission.IsOwner()` is *repository* access mode owner, which an org admin
  team member holds without being an organization owner. The fix replaces it
  with `Organization.CanChangeRepoTeamAccess` (`RepoAdminChangeTeamAccess ||
  doer.IsAdmin || org.IsOwnedBy(doer)`). Separately, the API's
  "repo is not owned by an organization" branch was **missing its `return`** and
  fell through.
- **Why it matters to Beyond Green:** the visible outcome is a persisted
  `organization.TeamRepo` row, so the symptom is database state, and the
  consequence is a team gaining read access to a repository. A DB snapshot after
  a "successful" UI flow shows the row.
- **Pre-existing tests that passed:** `tests/integration/api_repo_teams_test.go`
  → **`TestAPIRepoTeams`**, and `tests/integration/api_team_test.go` →
  `TestAPIAddRemoveTeamRepositoryRequiresOrgOwnerOrSetting`.
- **The specific assertion that was absent:** `TestAPIRepoTeams` checked 403
  only for user4, who has **no** access to the repo at all. It never exercised
  the actual gap — a caller who *is* a repo admin via an org admin team but is
  *not* an org owner. The fix adds exactly that: it puts admin team 12 on the
  repo, authenticates as user 28, asserts 403 on `PUT`/`DELETE`, and then
  asserts the persisted state both ways —
  `assert.False(t, repo_service.HasRepository(..., targetTeam, ...))` and
  `assert.True(t, repo_service.HasRepository(..., existingTeam, ...))`.
- **Bonus, and a caution worth recording.** The pre-existing web-layer test
  `routers/web/repo/setting/settings_test.go::TestAddTeamPost_NotAllowed` passed
  because it **mocked away the thing that was broken**: it hand-built
  `&context.Repository{Owner: &user_model.User{RepoAdminChangeTeamAccess: false}}`
  in memory, so only the flag branch was ever reachable and real permission
  resolution never ran. The fix rewrites it onto real fixtures. This is a useful
  second pattern for the benchmark — coverage defeated by a fabricated context —
  though as a unit test it is weaker evidence than G1's integration case.

## G4 — private repository content readable through RSS/Atom with a wrong-scope token (class C)

- **Fix:** PR [#38108](https://github.com/go-gitea/gitea/pull/38108)
  "fix: Various sec fixes 2", commit
  `9e84deb969aff5c1115c2984e41250f28c78451f` (2026-06-17).
  [commit](https://github.com/go-gitea/gitea/commit/9e84deb969aff5c1115c2984e41250f28c78451f)
- **The defect:** none of `ShowRepoFeed`, `ShowBranchFeed`, `ShowFileFeed` or
  `ShowReleaseFeed` checked repository token scope. A PAT holding only
  `read:misc` could read private repository commit and activity data and receive
  **HTTP 200 with the private content in the body**. The fix adds one
  `checkRepoFeedTokenScope` guard, mirroring the existing download-token check.
- **Pre-existing test that passed:** `tests/integration/feed_repo_test.go` →
  **`TestFeedRepo`** (file added 2025-01-27 by
  [#33411](https://github.com/go-gitea/gitea/pull/33411)). It requests
  `/user2/repo1.rss`, asserts 200, asserts the body contains `<rss version="2.0"`,
  unmarshals the XML, and asserts channel link, `PubDate`, item count and item
  description.
- **The specific assertion that was absent:** every assertion is about feed
  *shape* on a **public** repo. Nothing asserted authorization — no request with
  an insufficiently scoped token, and no request against a private repository.
  The fix adds `TestFeedRepoContentTokenScopes`, which drives **nine** feed URLs
  on the private `user2/repo2` and asserts `http.StatusForbidden` for a
  `read:misc` token and `http.StatusOK` for a `read:repository` token.
- **Class C rationale:** the contradiction is across sources — the token record
  grants no repository scope, yet the HTTP response is 200 carrying private repo
  data. Note this is a read-path leak, so it scores lower on the
  "persisted state rather than visual" criterion than G1–G3.
- **Sharpest single assertion gap in the commit, as a pattern.** The same PR
  redacts notification subjects after access revocation. The pre-existing unit
  test `services/convert/notification_test.go::TestToNotificationThreadOmitsRepoWhenAccessRevoked`
  asserted `assert.Nil(t, thread.Repository)` **and nothing else**, so private
  issue metadata continued to leak through `thread.Subject` while the test was
  green. The fix adds a sibling test whose payload is one extra line:
  `assert.Nil(t, thread.Subject)`. As a demonstration of "the assertion was
  absent" this is the cleanest artefact found anywhere in this review; as
  benchmark material it is weaker, being a unit test.

## G5 — duplicate Actions email on a cancelled run (class A)

- **Fix:** PR [#35215](https://github.com/go-gitea/gitea/pull/35215) "Prevent
  duplicate actions email", commit
  `c7b99c8cc7c7bfaf0e54b9528eb594b17809475a` (2025-08-24).
  [commit](https://github.com/go-gitea/gitea/commit/c7b99c8cc7c7bfaf0e54b9528eb594b17809475a)
- **Why it is interesting:** the PR body is a manual reproduction recipe that
  names our evidence sources directly — "Trace log… Run the workflow… cancel it
  manually. **Observe trace log and mailbox.**" It is the plan's canonical class A
  shape: the user-facing flow succeeds and an extra email goes out. The
  integration config's `[mailer] PROTOCOL = dummy` gives a capturable channel.
- **Pre-existing coverage:** `tests/integration/repo_webhook_test.go`, to which
  the fix adds **+447/−24**.
- **Caveats:** the change is a refactor as much as a fix — it rewrites
  `MailActionsTrigger` to return `error`, moves the run-status guard out of
  `services/mailer/notify.go`, and adds a job-completeness check in
  `composeAndSendActionsWorkflowRunStatusEmail`. Reverting it cleanly is
  therefore harder than G1. No linked issue.

## G6 — retracted approval still satisfied codeowner branch protection (class B)

Recorded because it is the one case whose fix touches a pre-existing **Playwright**
file, which is useful evidence that the browser suite is actively maintained.

- **Fix:** PR [#38988](https://github.com/go-gitea/gitea/pull/38988) "fix: allow
  re-requesting uncounted review approvals", commit
  `d93bd06d0c29c3f57783818e191b98c14494a836` (2026-09-08).
  [commit](https://github.com/go-gitea/gitea/commit/d93bd06d0c29c3f57783818e191b98c14494a836)
- **The persisted-state defect:** `services/issue/pull.go`'s
  `HasAllRequiredCodeownerReviews` queried only
  `{ReviewTypeApprove, ReviewTypeReject}`. A re-requested review leaves a
  `ReviewTypeRequest` row, so branch protection kept counting a **retracted**
  codeowner approval as satisfied.
- **Pre-existing test that passed:** `tests/integration/pull_review_test.go` →
  **`TestPullView_CodeOwner`**, which already asserted
  `assert.True(t, hasCodeownerReviews)` after an approval.
- **The specific assertion that was absent:** it never re-requested the review
  and re-checked. The fix inserts five lines doing exactly that, ending
  `assert.False(t, hasCodeownerReviews)`.
- **Caveat:** the PR is partly a feature change (it newly *permits* retracting
  one's own approval), and the Playwright and template edits are UI affordance
  work. Treat the `pull.go` hunk as the regression, not the whole commit.

## Gitea risks

- **The audit subsystem is one day old.** `feat: Add audit logging`
  ([#38189](https://github.com/go-gitea/gitea/pull/38189), commit
  `da37b7916b7ef23bb334e27a4dbbb4f12aa96402`, 136 files) merged **2026-09-12
  08:15 UTC**, hours before the pinned revision. It is a genuine future asset —
  a first-class audit event stream is close to an ideal class F evidence source —
  but it has **no historical fix trail at all**, so it yields no held-out gap
  today. It also means the pinned SHA contains a very large same-day merge;
  if the first build is unstable, pin before `da37b791` and accept losing the
  audit stream.
- G1 depends on Actions cron timing and mock runners. The upstream test drives
  `actions.StopEndlessTasks` directly and mocks `EndlessTaskTimeout` down to one
  second rather than waiting on the scheduler; the benchmark should do the same
  instead of relying on wall-clock cron.
- Counts here are static source counts. No suite was collected or run.

---

# 2. Forgejo — second application, and the single cleanest class-F gap

Pin **`forgejo/forgejo@e58c82f6de4fe6ecb21c526802827a07e8d64118`** (2026-09-12,
branch `forgejo`). Hosted on Codeberg, so use the Gitea-flavoured REST API
(`https://codeberg.org/api/v1/...`) rather than `gh`.

Go 1.26 (`module forgejo.org`), Vue 3.5 frontend, Playwright 1.62.1 with a
root `playwright.config.ts`. **`make test-e2e-sqlite` exists — verified, not
assumed:**

```make
test-e2e: test-e2e-sqlite

test-e2e-sqlite: playwright e2e.sqlite.test generate-ini-sqlite
	PROJECT_ROOT="$(CURDIR)" PROJECT_CONF=tests/sqlite.ini ./e2e.sqlite.test -test.run TestE2e
```

There is also `test-e2e-sqlite#%` for a single spec and `test-e2e-debugserver`.
`tests/sqlite.ini.tmpl` sets `DB_TYPE = sqlite3` with `PATH` under
`forgejo-{{TEST_TYPE}}-sqlite/forgejo.db` — a real file, snapshottable
mid-test. Suites: **375** `*_test.go` in `tests/integration`, **63**
`*.test.e2e.ts` in `tests/e2e`. CI is `.forgejo/workflows/testing.yml`, where
`test-e2e` and `test-sqlite` are both `needs` of the merge gate.
No Docker for the SQLite path; no Kubernetes.

**Risk specific to Forgejo:** the full Playwright set runs on push, on the PR
label `run-all-playwright-tests`, or when the PR title contains "playwright";
otherwise it is changed-files-selected. So "green CI" on a Forgejo PR is a weaker
claim than on Gitea, and the doc should not overstate it.

## F1 — PR review dismissal never wrote an activity row (class F) ★

**The cleanest single assertion gap found in this entire review**, and a direct
hit on the brief's "an audit or activity record never written".

- **Fix:** PR [#8853](https://codeberg.org/forgejo/forgejo/pulls/8853)
  "fix: PR review dismissals were not appearing in activity feed", commit
  **`9524b8c3702e204d9f942090acb39a3549c80ca8`** (2025-08-11).
  [commit](https://codeberg.org/forgejo/forgejo/commit/9524b8c3702e204d9f942090acb39a3549c80ca8)
- **The defect, verified in the diff:** the notifier method in
  `services/feed/action.go` was misspelled.

  ```go
  -func (*actionNotifier) NotifyPullRevieweDismiss(ctx context.Context, ...)
  +func (*actionNotifier) PullReviewDismiss(ctx context.Context, ...)
  ```

  A Go notifier only receives dispatch through correctly-named interface
  methods, so the body was **dead code**: dismissing a review returned success,
  the review row was updated correctly, and **no `Action` row was ever written**.
  The upstream author's own words: "Discovered that `NotifyPullRevieweDismiss`
  was dead code… it should have been `PullReviewDismiss` when originally
  implemented." A second independent silent drop sat in
  `templates/user/dashboard/feeds.tmpl`, which branched on the op-type string
  `review_dismissed` where the real constant is `pull_review_dismissed`.
- **Pre-existing test that passed:** `tests/integration/api_pull_review_test.go`
  → **`TestAPIPullReview`**. Verified present at the fix's parent
  (`9524b8c3…~1`, function at line 151): it `POST`s to
  `/api/v1/repos/{o}/{r}/pulls/{index}/reviews/{id}/dismissals`, then asserts
  `assert.EqualValues(t, 6, review.ID)` and **`assert.True(t, review.Dismissed)`**;
  it then exercises `/undismissals` and asserts
  `assert.False(t, review.Dismissed)`.
- **The specific assertion that was absent:** the test asserted the **API
  response and the review's own state**, and never that the side effect — an
  `Action`/activity row — had been written. The dismissals block dates to
  `c8ded7768` (2022-09-02), so the feature carried passing integration coverage
  for roughly **three years** while the activity record was silently never
  created. The fix adds `TestDashboardReviewWorkflows` to the pre-existing
  `tests/integration/user_dashboard_test.go`, which calls
  `pr_service.DismissReview(...)` and then asserts the rendered feed via
  `#activity-feed .flex-item-main .title` and `… .flex-item-body`.
- **Why this is the model class-F case:** request succeeded, primary state
  correct, telemetry absent, and the gap is provable from the pre-existing
  assertions alone. It needs no cron timing and no mock runner, so it is
  materially easier to stage than Gitea G1 — at the cost of not also covering D.
- **Caveat:** no user-filed issue; the PR is the record. The pre-existing test
  asserting the feature is in a *different* file from the one the fix extends,
  so the "same file" heuristic does not apply — the argument rests on
  `TestAPIPullReview` covering the dismissal feature, which was verified
  directly at the parent commit.

## F2 — draft release attachments readable by read-only and anonymous callers (class C)

- **Fix:** PR [#13934](https://codeberg.org/forgejo/forgejo/pulls/13934)
  "fix(security): prevent unauthorized access to draft release attachments",
  commit `0dd9751b2ec749b8ef70a9f392de7972d6b3d5d5` (2026-08-22).
  [commit](https://codeberg.org/forgejo/forgejo/commit/0dd9751b2ec749b8ef70a9f392de7972d6b3d5d5)
- **The defect, in upstream's words:** `GetReleaseAttachment`
  (`GET /repos/{owner}/{repo}/releases/{id}/assets/{attachment_id}`) and
  `ServeAttachment` (`GET /attachments/{uuid}`) "did not check whether the
  release is a draft", so read-only and unauthenticated callers on public repos
  "could enumerate release/attachment IDs and retrieve the metadata and the full
  contents of attachments belonging to draft releases". `GetRelease` and
  `ListReleaseAttachments` had been hardened in the 2026-06-10 security patches;
  these two endpoints were missed. Same class as Gitea's CVE-2026-27660 /
  GHSA-q9pg-jj6x-j9p6.
- **Pre-existing test that passed:** `tests/integration/api_releases_test.go` →
  **`TestAPIReleaseGetAssets`**, which contains a subtest literally named
  **`"draft release, no permission"`** asserting 404.
- **The specific assertion that was absent:** that subtest asserted 404 on the
  **list** endpoint only. Nothing covered the **single-asset** API route or the
  **web** `/attachments/{uuid}` route for a draft release. A test named for the
  exact threat passed while two sibling routes served the content. The fix adds
  `TestAPIReleaseDraftAttachmentUnauthorizedAccess`, asserting
  `http.StatusNotFound` on both.
- **Caveat:** a read-path leak rather than persisted state, so it ranks below F1
  on criterion 2.

---

# 3. Woodpecker CI — fast, dependency-light, but narrow

Pin **`woodpecker-ci/woodpecker@389b8e57e32b8d70a42669835f5e5017929a2763`**
(2026-09-12). Go 1.26 (`go.woodpecker-ci.org/woodpecker/v3`), Vue 3.5 + Vite 8.

Setup is the fastest here, roughly 5–10 minutes, with **no Docker and no
Kubernetes** — the E2E harness runs an in-process agent against
`pipeline/backend/dummy`. Its own CI (`.woodpecker/test.yaml`, step `test-e2e`)
genuinely runs `make test-e2e`:

```sh
go test -race -cover -coverpkg=./... -coverprofile e2e-coverage.out \
  -timeout 60s -tags 'test $(TAGS)' ./e2e/...
```

**Two disqualifying-for-primary limitations, stated plainly.** First, the E2E
suite is real but **narrow**: 14 test functions across 8 scenario files in
`e2e/scenarios/`, all scheduling-shaped (matrix, cancel, restart, gated,
concurrency, agent-label routing, `depends_on`). There is no webhook,
permission, or HTTP-API scenario at all — precisely the surfaces this domain was
chosen for. Second, the E2E store is **`sqlite3` with `Config: ":memory:"`** and
`MaxOpenConns=1` (`e2e/setup/store.go`, `newStore`), so the database **cannot be
file-snapshotted** before teardown without changing the driver. Both findings
below live in datastore tests, not in `e2e/`.

## W1 — repo delete orphaned pipeline and step rows (class B)

A textbook "coverage existed, fixture too small" case.

- **Issue:** [#6970](https://github.com/woodpecker-ci/woodpecker/issues/6970);
  **fix:** [PR #6971](https://github.com/woodpecker-ci/woodpecker/pull/6971),
  commit `1992b586d8d47f2db2321f2f0ed6bf0666b5aa99` (2026-08-17), "Fix orphaned
  pipelines after repo delete".
  [commit](https://github.com/woodpecker-ci/woodpecker/commit/1992b586d8d47f2db2321f2f0ed6bf0666b5aa99)
- **The defect, verified in the diff:** `deleteRepo` in
  `server/store/datastore/repo.go` paged with
  `sess.Limit(batchSize, startPipelines)` while **advancing `startPipelines` and
  deleting as it went**, so surviving rows shifted under the cursor and only the
  first page was ever removed. `DeleteRepo` still returned `nil`. The fix drops
  the offset entirely: `sess.Limit(perPage)` in a loop until empty.
- **Pre-existing test that passed:** `server/store/datastore/repo_test.go` →
  **`TestRepoCrud`**, which already asserted the cascade with
  `assert.EqualValues(t, 1, pipelineCount)` and
  `assert.EqualValues(t, 1, stepCount)` (the residual 1 belonging to an
  unrelated repo).
- **The specific assertion that was absent:** none, in a sense — the assertion
  was *there and correct*. The fixture created exactly **one** pipeline, below
  `perPage` (50), so the pagination loop never took a second iteration and the
  bug could not manifest. The fix adds `TestRepoDelete`, creating **60**
  pipelines and asserting both counts reach 0. Worth recording as its own
  pattern: an adequate assertion defeated by an undersized fixture.

## W2 — revoked forge permissions never pruned (class B, leaning E)

- **Fix:** [PR #5790](https://github.com/woodpecker-ci/woodpecker/pull/5790),
  commit `87ec6ceccb30dac43a7ce7de245223cbf4772873` (2025-11-29).
  [commit](https://github.com/woodpecker-ci/woodpecker/commit/87ec6ceccb30dac43a7ce7de245223cbf4772873)
- **The defect:** `updateRepoPermissions` in `server/api/login.go` was
  upsert-only. Per the PR, sync was "effective only for adding access, not
  removing it… allowing users to retain CI access to repositories they should no
  longer be able to" reach. The fix adds `PermPrune`
  (`server/store/datastore/permission.go`, `server/store/store.go`,
  `mock_Store.go`).
- **Pre-existing tests that passed:**
  `server/store/datastore/permission_test.go` → `TestPermFind`, `TestPermUpsert`;
  and `server/api/login_test.go`.
- **The specific assertion that was absent:** nothing asserted that a `perms`
  row for a repo the forge no longer returns is **deleted** after login sync.
  The fix adds `TestPermPruneDeleteAll` and `TestPermPruneKeepOne`.
- **Caveat:** no linked issue; the PR body is the evidence. Stale authorization
  rows surviving a sync are a persisted-state defect with an access consequence.

---

# 4. Zulip — best bug trail, worst setup fit

Pin **`zulip/zulip@675c8cf9927e48b922afd4dd31dad68bb505928f`** (2026-09-11).
Django, Python 3.10–3.14, TypeScript web.

**Fails criterion 3 on setup, and there is no SQLite escape.** The engine is
hardcoded to `django.db.backends.postgresql`
(`zproject/computed_settings.py:353`), and provisioning also requires Redis,
memcached and RabbitMQ, plus the pgroonga full-text extension
(`tools/lib/provision.py`). On macOS the documented path is **Vagrant + Docker
Desktop**, realistically **40–75 minutes** for a first `tools/provision`, with a
known VirtioFS `ERR_PNPM_LINKING_FAILED` failure mode that needs Docker Desktop
flipped to `osxfs (legacy)`. No Kubernetes, at least.

**The browser suite is smoke-level and should not be the target.**
`web/e2e-tests` holds 20 Puppeteer files with exactly one `common.run_test()`
each — **20 cases** — and CI runs them in only 1 of 5 matrix jobs
(`zulip/ci:jammy`, the sole job with `include_frontend_tests: true`). The real
asset is the Django suite: **4,118 `test_` functions across 150 files** in
`zerver/tests`, plus **91 webhook integration modules** under
`zerver/webhooks/*/tests.py`, run by `./tools/test-backend` with
`--include-webhooks --include-transaction-tests` on all five CI jobs.

Snapshotting is genuinely first-class: Zulip already maintains a Postgres
template database (`BACKEND_DATABASE_TEMPLATE = "zulip_test_template"`) and
`reset_zulip_test_database()`, which the Puppeteer runner calls between files.

## Z1 — GitHub webhook posted a duplicate review message, both 200 (class A)

The best match in the review to "a webhook that fires twice while the request
returns 200", and the only finding with a *user-reported, shipped-to-users*
paper trail.

- **Issue:** [#26145](https://github.com/zulip/zulip/issues/26145) "GitHub bot
  sends duplicate 'submitted PR review' messages" (opened 2023-06-28, closed
  2024-07-31). **Fix:** commit
  `b5c63cfb8553f70d168ae29c692e63da6418bb80` (2024-05-27), "integrations:
  Prevent duplicate GitHub pull request review messages" —
  `zerver/webhooks/github/view.py` +14 (a new
  `is_empty_pull_request_review_event`), `zerver/webhooks/github/tests.py` +4,
  and one new fixture.
  [commit](https://github.com/zulip/zulip/commit/b5c63cfb8553f70d168ae29c692e63da6418bb80)
- **Pre-existing tests that passed:** `zerver/webhooks/github/tests.py`, already
  ~800 LOC, with `test_pull_request_review_msg`,
  `test_pull_request_review_msg_with_custom_topic_in_url`,
  `test_pull_request_review_msg_with_empty_body`, and
  `test_ignored_pull_request_actions`.
- **The specific assertion that was absent:** no test asserted the **message
  count** for GitHub's real two-event sequence. The existing tests posted only
  the single `submitted` payload; the follow-up
  `action="edited", changes={}` payload was never exercised, so the endpoint
  returned 200 and wrote a **second** Zulip message for ~11 months under
  otherwise full integration coverage of the same webhook. The fix adds
  `test_pull_request_review_edited_empty_changes_ignore`.

## Z2 — stream move sent no live-update to old-stream subscribers (class F, fix adds no assertion)

- **Issue:** [#33719](https://github.com/zulip/zulip/issues/33719) "No
  live-updates when moving messages to a public unsubscribed channel"
  (2025-02-28 → 2025-03-04). **Fix:** commit
  `6801c6de7b8559631d9f45ae57dfd20049038235` (2025-03-02),
  `zerver/actions/message_edit.py` **+20/−1**, adding
  `old_stream_subs_not_in_new_stream` and unioning it into `notifiable_ids`.
  [commit](https://github.com/zulip/zulip/commit/6801c6de7b8559631d9f45ae57dfd20049038235)
- **Pre-existing tests that passed:** `zerver/tests/test_message_move_stream.py`
  (`test_move_message_to_stream_and_topic`) and `test_message_move_topic.py`.
- **The specific assertion that was absent:** this is the brief's third evidence
  category in its purest form — **the fix adds no behavioural assertion at all.**
  Its only test edits are query-count bumps: `assert_database_query_count(59)` →
  `(61)`, and `(29/34/31/24)` → `(31/36/33/26)`. No test in either file asserts
  the **recipient set** of the `update_message` event on a stream move. The move
  returned success; old-stream subscribers silently received no event.

## Z3 — private-stream search filter broken by a wrong column for 13 months (class C)

- **Fix:** commit `ad31ef22f2b45a1e63ff97a4880535838af9b680` (2025-04-10),
  `zerver/lib/narrow.py` **+1/−1**: in `get_base_query_for_search`,
  `literal_column("zerver_recipient.type_id")` → `"zerver_recipient.type"`.
  [commit](https://github.com/zulip/zulip/commit/ad31ef22f2b45a1e63ff97a4880535838af9b680)
- **Pre-existing coverage:** the access restrictions and 184 lines of tests
  landed in `zerver/tests/test_message_fetch.py` in
  `cb0560d7340f6b4d35e2ec8fcd5bf1fe9a1b0c07` (2024-03-05) — 13 months before the
  fix.
- **The specific assertion that was absent, and a warning:**
  `test_get_messages_queries` and `test_get_messages_with_narrow_queries`
  asserted the **generated SQL string**, which literally contained
  `zerver_recipient.type_id != 2`. **The tests asserted the bug** and passed for
  13 months; the fix's only test change was rewriting 18 hardcoded SQL strings.
  No behavioural test asserted that search cannot return messages from a private
  stream the caller lacks access to. Worth recording as an anti-pattern the
  agent should be able to reason about: coverage that pins the implementation
  instead of the requirement.

## Zulip contamination warning

`zerver/tests/test_audit_log.py` carries two otherwise attractive "audit entry
written with wrong data" fixes — `2b63b2b30f5f24b680549618a17fabeae8fad1d1`
(2026-07-31, `USER_ROLE_CHANGED`) and `db0e39f5f2f909d355cf50e19fc949eb8cd5f089`
(2026-08-03, `USER_CREATED`). **Verified: both commit messages carry
`Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`**, the same
attribution line this project uses. They are very likely this project's own
prior upstream work and **must not be used as benchmark ground truth**. Also
available and uncontaminated if an extra class A case is wanted:
`c821127131d2711fb8183ae33a718c908235c0cf` (2022-11-15, "resolution notification
not being sent twice", `zerver/tests/test_message_edit.py` +68).

---

# 5. Huly — capable suite, prohibitive infrastructure

Pin **`hcengineering/platform@63e28dc96483967b2fc21c881b3f1023c1de7718`**
(2026-08-27, `develop`). TypeScript monorepo (Rush + pnpm), roughly 20
microservices.

The Playwright suite is substantial and really does run in CI:
`tests/sanity/tests/` holds **54 `.spec.ts` with 215 `test()` cases**, plus
`qms-tests/sanity` (16) and `ws-tests/sanity` (3), driven by
`rushx uitest` → `playwright test -c ./tests/playwright.config.ts`, with jobs
`uitest`, `uitest-pg`, `uitest-qms` and `uitest-workspaces` on PRs to `develop`
(`.github/workflows/main.yml`, `timeout-minutes: 60`).

**Rejected on criterion 3.** `tests/docker-compose.yaml` requires MongoDB 7,
CockroachDB v24.1.2, Postgres 18.1, Redpanda (Kafka) v24.3.6, MinIO and
Elasticsearch 7.14.2, plus nine `hardcoreeng/*` service containers — about
**16 containers**. No SQLite. Kubernetes is *not* required, which is the one
constraint it passes. Before the suite runs you need `rush install`, a full
`rush docker` build of every service image, then `tests/prepare.sh` (bring up 16
containers, `wait-elastic.sh`, create three accounts, create a workspace,
restore a workspace snapshot) and a `127.0.0.1 huly.local` hosts entry. CI
budgets 60 minutes on a warm runner; a cold macOS run is well past the ~30-minute
target. Snapshotting would be excellent if we got there
(`update-snapshot.sh`, `restore-workspace.sh`, `restore-pg.sh`,
`restore-cockroach.sh`).

No historical gap was pursued. Huly's commit hygiene works against the mining
technique: conventional-commit subjects with no `Fixes #N` convention and no
issue links, so "fix commit plus pre-existing test file" yields little.

---

# 6. Plane — disqualified

Pin **`makeplane/plane@2f895b82dad839c730c36a5c0cbc046f1e5d6b56`** (2026-09-10,
`preview`). Next.js/TS monorepo plus a Django API; Postgres 15.7, Valkey 7.2.11,
RabbitMQ 3.13.6 and MinIO by compose. `deployments/kubernetes/community/` exists
but is optional, so Kubernetes is not a blocker.

**There is no browser test suite at all** — no Playwright, no Cypress, no
Puppeteer anywhere in the tree. A pytest suite does exist
(`apps/api/plane/tests/`, 59 `test_*.py` across `unit/`, `contract/api/`,
`contract/app/`, `smoke/`, run by `python -m pytest`), **but GitHub Actions never
invokes it**: across all nine workflows there is no `pytest`, `manage.py test`,
`playwright` or `cypress` invocation. The only API PR workflow,
`pull-request-build-lint-api.yml`, has a single job, `lint-api`, running
`ruff check --fix apps/api` — and it is gated on
`draft == false && requested_reviewers != null`, so it does not even lint until a
reviewer is requested.

Setup would have been the quickest of the three heavyweights (~15–25 min) and
Postgres snapshots easily. Irrelevant: a benchmark whose premise is "CI was
green and missed the regression" needs a CI that runs tests. Any injected
regression passes Plane's CI unconditionally, which yields no signal.

---

# Regression-class coverage map

Current benchmark gaps are **D** and **F**. Both are now addressable.

| Class | Best candidate | Evidence |
|---|---|---|
| A — unexpected side effect | Zulip Z1 (duplicate webhook message, both 200); Gitea G5 (duplicate Actions email) | `b5c63cfb8553f70d168ae29c692e63da6418bb80`; `c7b99c8cc7c7bfaf0e54b9528eb594b17809475a` |
| B — incorrect database state | Gitea G2 (seven orphaned tables); Gitea G3 (team-repo row); Woodpecker W1 (orphaned pipelines) | `9ad80e1ebaf3b5598797f103a7b204c71dbbf456`; `204c0bafd358d69d7d1a565a89d4f16b440efda4`; `1992b586d8d47f2db2321f2f0ed6bf0666b5aa99` |
| C — conflicting sources | Gitea G4 (200 + private RSS content vs. token scope); Forgejo F2 (draft attachment served); Zulip Z3 (tests pinned the bug) | `9e84deb969aff5c1115c2984e41250f28c78451f`; `0dd9751b2ec749b8ef70a9f392de7972d6b3d5d5`; `ad31ef22f2b45a1e63ff97a4880535838af9b680` |
| **D — background failure** | **Gitea G1** — three registered cron tasks (`@every 5m/30m/6h`, all `RunAtStart`) reaped tasks correctly but dropped the outbound run notification | `8fdd6d1235393f6e5cd3027872121a3a9868d3d1` |
| E — state leakage | Woodpecker W2 (stale `perms` rows survive sync) — weakest coverage; nothing here is a true cross-test leak | `87ec6ceccb30dac43a7ce7de245223cbf4772873` |
| **F — missing telemetry** | **Forgejo F1** — dismissal succeeded, no `Action` row ever written, ~3 years under passing coverage. Also **Gitea G1** (webhook event never arrived) and Zulip Z2 (event recipients omitted) | `9524b8c3702e204d9f942090acb39a3549c80ca8`; `8fdd6d1235393f6e5cd3027872121a3a9868d3d1`; `6801c6de7b8559631d9f45ae57dfd20049038235` |

Class **E** remains the thinnest. Nothing found in this domain is a genuine
cross-test leak; W2 is stale-authorization persistence, which is closer to B.
If E matters, it likely needs a deliberately constructed case rather than a
historical one.

# Prior art to acknowledge, not import

Twenty ships an adjacent test-investigation agent ("QA Scout"), noted in
[benchmark-selection.md](benchmark-selection.md). Acknowledge it as prior art.
**Do not import or adapt any agent or test-investigation implementation** from
Twenty or from any project reviewed here. Nothing in this document proposes
copying upstream code; the only upstream artefacts to reuse are the *test
assertions* the fixes added, held out as ground-truth oracles, and those are
cited rather than vendored.

# Not verified

Everything in this section is an open risk. None of it was measured.

**Nothing was executed.** No repository here was built, installed, provisioned,
seeded, or run. No test suite was collected, and no test was observed to pass or
fail. **No regression was reproduced.** Every finding is a source-backed
candidate.

**Not verified, specifically:**

1. **That any pre-existing test actually passes at the fix's parent commit.** The
   claim throughout is that the fix's own added assertion documents an earlier
   absence. That the older test was *green* on the buggy code is inferred from it
   being in CI, not observed. It has not been run at the parent SHA, which is the
   single most important unverified premise in this document.
2. **That reverting a fix hunk leaves the pre-existing tests green.** Other
   upstream tests may catch the reverted behaviour. Gitea has 723 integration
   functions and 51 browser cases; any of them may assert the same invariant
   incidentally. This must be demonstrated per candidate, and selected-test green
   must be reported separately from full-suite green.
3. **Setup costs.** The ~20–30 minute Gitea figure and ~20–40 minute Forgejo
   figure are estimates from reading `Makefile`, `tools/test-e2e.sh` and the CI
   workflows. Go 1.27, Node ≥ 22.18.0, pnpm 12.2.1 and Playwright browser
   downloads were not installed or timed on this host.
4. **That Playwright runs locally on macOS without a container.** Inferred from
   `detect_playwright_mode` selecting container mode only on non-Debian-family
   Linux. Not executed. The local Docker daemon was previously found not running
   (see [benchmark-selection.md](benchmark-selection.md)), so this matters.
5. **That the SQLite file is readable at the moment we want it.** File paths are
   confirmed from config (`$WORK_DIR/data/gitea.db`; `gitea-test.db` under
   `TEST_WORK_PATH`; Forgejo's `forgejo.db`). WAL state, locking, and whether a
   consistent snapshot can be taken *before* teardown were not tested.
6. **G1's timing behaviour.** Whether the Actions cron path can be driven
   deterministically in our harness — and whether the mock-runner machinery the
   upstream test relies on is reusable as-is — is unverified. Upstream mocks
   `EndlessTaskTimeout` to one second and calls `StopEndlessTasks` directly
   rather than waiting for the scheduler.
7. **G2's browser-level reach.** Repository deletion's pre-existing coverage was
   confirmed only at service level (`services/repository/delete_test.go`). Whether
   a Playwright or HTTP integration path exercises deletion and stays green under
   the reverted cascade is unknown.
8. **Test counts.** 51 Playwright cases / 28 files, 723 integration functions /
   261 files (Gitea); 63 specs, 375 files (Forgejo); 14 E2E functions
   (Woodpecker); 20 Puppeteer cases, 4,118 backend functions (Zulip); 215
   Playwright cases (Huly). All are static source counts from a sparse checkout
   or subagent inspection — not collected or passing counts.
9. **Forgejo and Woodpecker CI green-ness.** Forgejo's full Playwright run is
   label-gated on pull requests, so "CI was green" is a weaker claim there than
   on Gitea. No CI run was inspected for any specific historical commit in any
   project; no finding below rests on a cited green CI log.
10. **Zulip and Huly figures** come from subagent inspection. The Zulip
    contamination claim, the Zulip Z1 commit, and all Forgejo and Woodpecker
    commits cited above **were re-verified directly against upstream**; the Huly
    container inventory and Plane workflow analysis were **not** independently
    re-checked.
11. **Pinned revision stability.** Gitea `1280de57…` includes the 136-file audit
    logging merge from the same morning; Forgejo `e58c82f6…`, Woodpecker
    `389b8e57…` and Plane `2f895b82…` are all same-week tips of moving branches
    (`forgejo`, `main`, `preview`). Re-pin and re-verify before building.
12. **Security framing.** G3, G4 and Forgejo F2 are authorization defects. This
    document reproduces upstream's own characterisation and does **not**
    independently assess exploitability or real-world impact. Do not restate them
    as confirmed disclosures.

## Acceptance gate

The gate in [benchmark-selection.md](benchmark-selection.md) applies unchanged.
For this domain, add two steps:

1. Check out the **parent** of the fix commit and run the pre-existing test
   named above. Record whether it passes on genuinely buggy code. This converts
   item 1 from inference to observation and is the first thing to do.
2. Then, at the pinned revision, revert only the application-code hunk, hold out
   the assertion the fix added, and confirm the pre-existing test is still green.
   Keep the held-out assertion and all mutation labels out of model input.
