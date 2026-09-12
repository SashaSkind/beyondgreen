# Held-out historical assertion gaps in server-rendered apps

Researched 2026-09-12 against public upstream Git history, GitHub issues/PRs, and
the redmine.org tracker. Domain: mature server-rendered applications with real
test suites in Django, Rails, or Laravel.

**Every finding below is a source-backed candidate.** Nothing here was installed,
built, or executed. No application was started, no test was run, no database was
snapshotted. Where this document says a test "passed while the defect was
present", that is an inference from the upstream fix commit (the maintainer had
to add or change the assertion), not an observation. The
["Not verified"](#not-verified) section lists every such inference explicitly.

## What counts as a finding here

The brief ranks evidence; this document tags each finding with the tier it
actually meets.

- **Tier 1** — the fix commit adds or strengthens an assertion or a test for the
  same feature, proving the previous test missed it. Sub-tier **1a** is the
  strongest available shape: the fix adds *only* assertion lines to an existing
  test method, with no fixture change, so the buggy path was already exercised by
  an unchanged upstream test.
- **Tier 2** — the issue or PR text says CI was green, the tests passed, or the
  bug shipped to users.
- **Tier 3** — the fix changes application code for a feature with existing
  coverage and adds no test at all.

The intended experimental recipe for a Tier-1a finding needs **no source
mutation at all**: pin the parent of the fix commit, run the named pre-existing
test unchanged, and use the assertion the maintainer later added as ground truth.
That is a strictly stronger benchmark case than the injected mutations used in
the Linkding harness, because the defect is historically real and the oracle is
upstream's own.

## Shortlist

| App | Pinned revision (buggy parent) | Stack | Test framework | Database | Best historical gap | Class | Harness reuse | Setup cost | Risks |
|---|---|---|---|---|---|---|---|---|---|
| **Healthchecks** | `4e108073ac3e971e37a52a3b579d7e5b1cb62288` | Django 6.x, server-rendered | `manage.py test` (Django unittest, `hc.test.BaseTestCase`) | SQLite default; PG/MySQL/MariaDB in CI | PagerDuty notification payload leaked the check's ping secret; existing `test_it_works` asserted six payload fields but not `incident_key` (Tier 1a) | A | High: reuse `run.py`, settings overlay, snapshot-in-teardown, validators. Replace Playwright observers with Django test-client + `HttpTransport` observers | Lowest (~15–25 min) | No browser suite at all, so no screenshots/traces; not pytest natively; `pycurl` needs libcurl headers on macOS |
| **paperless-ngx** | `02b2f55248af1da43759ede68e44223516bd822e` | Django 5.2 + DRF + Celery; Angular SPA front end | pytest + pytest-django (`uv run --dev --frozen pytest`); separate TS Playwright suite with a real disposable backend | SQLite (tests), PG/MariaDB supported | Restore-from-trash returned 200 and restored the row but never re-indexed the document; existing `test_api_trash` asserted the row and the trash list, never searchability (Tier 1 + Tier 2, user-reported, shipped in 3.1.0) | C + F | Medium-high for the pytest suite (same plugin-loading and `--ds` mechanism). The TS Playwright suite would need a new collector | Highest (`uv sync` pulls torch 2.13, sentence-transformers, llama-index, scikit-learn, ocrmypdf: multi-GB, likely >30 min) | Dependency weight is the main blocker; NLTK data; some suites need Gotenberg/Tika/nginx via Docker (`live` marker, deselectable) |
| **pretix** | `1521c0cfcd0a28ee456d0ce878f17f080d4529fa` | Django, server-rendered control + presale | pytest + pytest-django + **Python Playwright** `live_server` e2e suite | SQLite and Postgres both in CI | Cloning an event across organizers wrote `EventMetaValue` rows pointing at the *other* tenant's `EventMetaProperty`; existing `test_full_clone_cross_organizer_differences` passed (Tier 1, fixture extension required) | B | **Highest structural match** — Playwright sync API + pytest + Django ORM, same as Linkding. Snapshot hook moves from a helper `tearDown` to a `pytest_runtest_teardown` wrapper because state comes from the `db` fixture | Medium (`uv pip install -e ".[dev]"`, `gettext`, `make all compress`, npm for the widget) | The 3-file e2e suite covers only the embeddable widget; my pretix finding lives in the integration suite, not the browser suite |
| **Redmine** | `26712e67a3b832664d52a845d1c606751373f6de` | Rails 8.1, server-rendered | Minitest: `test/unit`, `test/functional`, `test/integration`, 28 Capybara/Selenium files in `test/system` | SQLite3, PG, MySQL all in CI | Destroying an issue custom field left orphaned `WorkflowPermission` rows; the fix shipped a data-repair migration, proving production databases accumulated them (Tier 1 + Tier 3 signal) | B | **None.** Needs a new Ruby/Minitest collector: snapshot before transactional rollback via a prepended `after_teardown`, plus a Ruby evidence writer. Selenium has no Playwright-tracing equivalent | Medium-high (~30–60 min: bundler, `database.yml`, migrate, Chrome for system tests) | Third language in the project; bug tracker is off-GitHub (redmine.org), so issue links are not GitHub URLs |
| Discourse | *not pinned — rejected* | Rails + Ember | RSpec, ~540 files under `spec/system` | Postgres + Redis + Sidekiq | not surveyed in depth | — | None | Well over the 30-minute budget | Largest browser suite of any candidate, but Postgres + Redis + Ember build + Sidekiq puts first green run far outside the MVP window |
| Mealie | *not pinned — out of domain* | FastAPI + SQLAlchemy; Nuxt SPA | pytest (API/integration only) | SQLite/PG | not surveyed in depth | — | pytest skeleton yes; the Django ORM snapshot does not transfer to SQLAlchemy | Medium | Not Django/Rails/Laravel and not server-rendered; strictly worse fit than pretix for the same effort |
| Monica / Firefly III | *not pinned — deprioritised* | Laravel (PHP) | PHPUnit/Pest `tests/Feature` + `tests/Unit`; **no** `tests/Browser` in either | MySQL/PG/SQLite | not surveyed in depth | — | None; needs a new PHP/PHPUnit collector | Medium-high | Neither has a browser suite, so Laravel buys a third runtime for HTTP+DB integration evidence we can already get from Django at a fraction of the cost. Monica's last upstream push was 2026-04 |

Repository revisions surveyed (HEAD at research time, for reproducing these
scans): Healthchecks `1b94965db6fc58b1c879c133f67db88b7895e9cf`, paperless-ngx
`72ea38ab126e92fb63d68b7f5d0e6d9abaafe589`, Redmine
`e8515b4d2c871e2c0360cb346d530f28e285378a`, pretix
`1aea5633ebffeb6fef849657eab2e421dfdad0b8`.

---

## 1. Healthchecks — best signal per hour of setup

`healthchecks/healthchecks`. Django, server-rendered templates, SQLite by
default, GitHub Actions `tests.yml` running `python manage.py test` across a
4-database × 3-Python matrix. 15 runtime dependencies, no Node, no browser, no
external services. Tests are `django.test.TestCase` subclasses of
`hc.test.BaseTestCase`, which seeds two users, a project and a profile in
`setUp`.

- CI: <https://github.com/healthchecks/healthchecks/blob/1b94965db6fc58b1c879c133f67db88b7895e9cf/.github/workflows/tests.yml>
- Base test case: <https://github.com/healthchecks/healthchecks/blob/1b94965db6fc58b1c879c133f67db88b7895e9cf/hc/test.py>
- SQLite default: <https://github.com/healthchecks/healthchecks/blob/1b94965db6fc58b1c879c133f67db88b7895e9cf/hc/settings.py> (`DATABASES`, `django.db.backends.sqlite3`, overridable by `DB` env var)

### H1 — PagerDuty incident payload leaked the check's ping secret (Tier 1a)

- **Fix commit:** `18bd44a68bd114d35732e3e7f0611999cd4a479c` — "Fix PagerDuty integration to not disclose check's code in incident data", 2024-04-22. <https://github.com/healthchecks/healthchecks/commit/18bd44a68bd114d35732e3e7f0611999cd4a479c>
- **Pin this revision (buggy):** `4e108073ac3e971e37a52a3b579d7e5b1cb62288`
- **Pre-existing test:** `hc/api/tests/test_notify_pd.py::NotifyPdTestCase::test_it_works` — <https://github.com/healthchecks/healthchecks/blob/4e108073ac3e971e37a52a3b579d7e5b1cb62288/hc/api/tests/test_notify_pd.py>
- **What that test already asserted:** `payload["description"]`, `payload["details"]["Description"]`, `payload["event_type"]`, `payload["service_key"]`, `payload["details"]["Last ping"]`, `payload["details"]["Total pings"]`, and `Notification.objects.count() == 1`.
- **Absent assertion:** `self.assertEqual(payload["incident_key"], self.check.unique_key)`. That single line is the *entire* test-side change in the fix commit — no fixture change, no new test method.
- **Symptom:** `PagerDuty.notify()` set `"incident_key": str(check.code)`. `Check.code` is the `UUIDField` that *is* the ping URL capability secret (`hc/api/models.py`, `code = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)`); `Check.unique_key` is the deliberately derived `sha1(code.hex[:16])`. So every down/up notification handed a third-party incident system a value that can be replayed to ping or fail the check.
- **Regression class:** **A** (unexpected side effect: an emitted event carried content it should not have). Weakly also **C**, since the API's own read-only representation deliberately withholds `code`.
- **Evidence shape for Beyond Green:** the outbound notification payload plus the `Check` row. The agent must notice that a field of the emitted event equals a secret column of the database — a cross-source correlation, not a diff.
- **Sibling findings, same shape, same day:** Opsgenie `577602ae2188e2ec32df22078661ad6e7ac851f0` (parent `bd64fab619b385274610f2c6cfe0c7c767559bb5`): pre-existing `hc/api/tests/test_notify_opsgenie.py::NotifyOpsgenieTestCase::test_it_works` asserted `payload["message"]`, `payload["description"]` and `payload["note"]` but never `payload["alias"]`, which held `str(check.code)`. Also Spike `41813996594c2327a4fc3867b5985892195647d4`, PagerTree `c08ba1d872f415d5235b258b34692374f31049dd`, Splunk On-Call/VictorOps `ddae6a04bf4d77b5c0dd44dc3f71d335a0b5fc75`. Note the difference: the Spike test *asserted the leaking value* (`payload["check_id"] == str(self.check.code)`), so it is a requirement change rather than a gap. Opsgenie's `test_opsgenie_up` likewise asserted `str(self.check.code) in url`. Only the `test_it_works` methods for PagerDuty and Opsgenie are pure Tier-1a gaps.
- **Unverified:** the transports are exercised with `@patch("hc.api.transports.curl.request")`, so no real socket traffic exists to capture. A collector must observe above the patch point (e.g. wrapping `hc.api.transports.HttpTransport.request`). I have not confirmed that wrapping point is reachable without touching upstream files. No linked GitHub issue or security advisory was found for this family; the evidence is the commits and the CHANGELOG entries.

### H2 — Email unsubscribe hard-deleted the channel instead of disabling it (Tier 1)

- **Fix commit:** `d53ffe39ea6fbe7a2ae2c0ce12441a9c9da255ec` — "Fix email integration's unsub view to disable (not delete) the channel", 2025-11-27. <https://github.com/healthchecks/healthchecks/commit/d53ffe39ea6fbe7a2ae2c0ce12441a9c9da255ec>
- **Pin this revision (buggy):** `ad5d90f7037e67334155480484592220f393fc63`
- **Pre-existing test:** `hc/integrations/email/tests/test_unsubscribe.py::UnsubscribeEmailTestCase::test_valid_signature_unsubscribes`
- **Application change:** `channel.delete()` → `Channel.objects.filter(id=channel.id).update(disabled=True)` in `hc/integrations/email/views.py::unsubscribe`.
- **Absent assertion:** the test asserted `Channel.objects.filter(code=self.channel.code).count() == 0`; the fix replaced that with `self.channel.refresh_from_db(); self.assertTrue(self.channel.disabled)`. The row-survives-with-a-flag assertion was absent.
- **Regression class:** **B**. This is the historically real analogue of the Linkding archive-to-delete mutation we already demonstrate: one click, one 200 response, one row destroyed where a flag was intended.
- **Honest caveat:** the pre-existing test asserted the *old intended* behaviour, so this is requirement drift rather than a silent gap. As a benchmark case it still works — at the pinned buggy revision the unchanged test passes and the row is destroyed — but the requirement ("disable, do not delete") has to be supplied to the agent from the later upstream implementation, exactly as `benchmark-lightweight.md` derives the archive requirement from `services/bookmarks.py`.

### H3 — Pausing an already-paused check wrote a spurious `paused → paused` flip (Tier 1)

- **Fix commits:** API `2319d1eb42ea575cd7ea8e5ea83d8ad5b415a6c9` (2025-12-27, parent `eebb394a4d9ce307b7dda51a9efc459dd0c8378f`); web UI `d90a109a172f32aa97d0c19bd5d54ec43c264831` (2025-12-28, parent `1c523a90b09f37846d352e6d46c2ac7f8bc8dfe0`).
- **Commit message (API):** "Before the fix, a call to the 'Pause' API call would creare a useless 'paused -> paused' status change event (flip). After the fix, we do not create the flip object any more. **The API call still returns the same response (HTTP 200 and the the check's JSON representation) as before.**" That last sentence is upstream stating the response is indistinguishable — the ideal Beyond Green framing.
- **Pre-existing tests:** `hc/api/tests/test_pause.py::PauseTestCase` (10 methods) and `hc/front/tests/test_pause.py::PauseTestCase` (7 methods). `test_it_works` / `test_it_pauses` assert status 200, `check.status == "paused"`, and `Flip.objects.get()` with the expected `old_status`/`new_status`/`processed`.
- **Absent assertion:** no pre-existing method exercised pausing a check whose status was *already* `"paused"`; the fix added `test_it_does_not_pause_already_paused_check` / `test_it_does_not_pause_an_already_paused_check`, each ending in `self.assertFalse(Flip.objects.exists())`.
- **Regression class:** **B** (extra persisted row), with a downstream **stale-aggregate** consequence — `Flip` rows are what `Check.downtimes()` reads for downtime reporting, so a junk flip corrupts a user-visible aggregate.
- **Honest caveat:** this is a missing *test case*, not a missing assertion on an already-exercised path. At the buggy revision no unchanged upstream test triggers the defect, so this case needs either a new caller or an injected mutation, unlike H1.

### H4 — "Clone check" silently dropped two fields (Tier 1)

- **Fix commit:** `5984d0f98b2164e89ce21798165a8366241cfc3c` — "Add missing fields in hc.front.views.copy", 2026-03-19 (parent `4e83d3a8d0ef0e6b7ff23fc47357cf28ffd51d55`).
- **Pre-existing test:** `hc/front/tests/test_copy.py::CopyCheckTestCase::test_it_works`, which already asserted `slug`, `filter_subject`, `filter_body`, `start_kw`, `success_kw`, `failure_kw` on the copy.
- **Absent assertion:** `copy.filter_http_body` and `copy.filter_default_fail`. The maintainer also back-filled assertions for `tags`, `desc`, `kind`, `timeout`, `grace`, `schedule` and `tz` in the same commit — a clear admission that the clone path was only partially asserted.
- **Regression class:** **B**. `filter_default_fail` governs how inbound pings are interpreted, so the clone was also functionally wrong, not merely incomplete.
- **Honest caveat:** the fix had to extend `setUp` to set the dropped fields to non-default values. At the buggy revision the fixture leaves them at their defaults, so the unchanged test produces *no observable state difference*. This case needs a fixture change or a differently seeded caller, which weakens it relative to H1.

### H5 — Confirming an email change also cleared the user's password (Tier 1)

- **Fix commit:** `918bb1d0d7fcc07d2dc9d99263128bd6e6f19e30`, 2026-03-09 (parent `3426423f4ca37d9e737be8f9e1a299c77f98e083`). Application change: delete one line, `user.set_unusable_password()`, from `hc/accounts/views.py::check_token`.
- **Pre-existing test:** `hc/accounts/tests/test_change_email_verify.py::ChangeEmailVerifyTestCase` — the fix flipped `self.assertFalse(self.alice.has_usable_password())` to `assertTrue`, with no fixture change.
- **Regression class:** **A/B** — a side effect on a column unrelated to the requested operation. The commit message explains the behaviour was intentional-but-wrong and confusing to real users.
- **Honest caveat:** same requirement-drift shape as H2 — the old test asserted the old behaviour. Observability is good though: `BaseTestCase` already gives Alice a usable password, so a DB snapshot at the buggy revision *does* show the password hash being destroyed by an email change.

### Also noted, not worked up

`e4e13034f1c535693ffcafd40a9f22691efac77f` (update_timeout did not kick off nags;
added one assertion to the existing `test_it_updates_status_to_down`, but needed
a `nag_period` fixture line), `324fa10ce76b6e03546ed9eb488f92da6a4a44fc`
(`Check.lock_and_delete` on an already-deleted check),
`0f62a8cd14d849052c020e93e767e421660fef59` (Signal channel disabled on
`UNREGISTERED_FAILURE`).

---

## 2. paperless-ngx — best single finding, worst setup cost

`paperless-ngx/paperless-ngx`. Django 5.2 + DRF + Celery, ~70 backend test
modules, `uv run --dev --frozen pytest` in `ci-backend.yml`, and — importantly —
`src-ui/e2e/backend.py` now boots a **real disposable Paperless instance** with a
seeded SQLite database for the Angular Playwright suite, instead of mocking the
API.

- Backend CI: <https://github.com/paperless-ngx/paperless-ngx/blob/72ea38ab126e92fb63d68b7f5d0e6d9abaafe589/.github/workflows/ci-backend.yml>
- Disposable e2e backend: <https://github.com/paperless-ngx/paperless-ngx/blob/72ea38ab126e92fb63d68b7f5d0e6d9abaafe589/src-ui/e2e/backend.py>
- Playwright config (two web servers: backend on 8001, UI on 4200): <https://github.com/paperless-ngx/paperless-ngx/blob/72ea38ab126e92fb63d68b7f5d0e6d9abaafe589/src-ui/playwright.config.ts>
- Browser suite is small: 5 spec files (`admin`, `dashboard`, `document-detail`, `document-list`, `permissions`).

### P1 — Restore from trash left the search index stale (Tier 1 + Tier 2) — strongest finding overall

- **Issue:** <https://github.com/paperless-ngx/paperless-ngx/issues/13813> — "Restoring a document from Trash does not update the search index", labelled `bug`/`backend`, closed. Reported against **released version 3.1.0**, reproduced on two documents, Postgres 18, Docker. The reporter's own words: *"No relevant webserver errors were logged during the restore operation. The document was successfully restored, but it was not searchable afterwards."* A full `document_index reindex` (847/847) was needed to recover.
- **Fix PR:** <https://github.com/paperless-ngx/paperless-ngx/pull/13818> — labelled `bug`, `non-trivial`, `backend`.
- **Fix commit:** `05917a04aaf1e968dc49ca6908511325fa2e35a2`, 2026-08-27.
- **Pin this revision (buggy):** `02b2f55248af1da43759ede68e44223516bd822e`
- **Pre-existing test:** `src/documents/tests/test_api_trash.py::TestTrashAPI::test_api_trash` — <https://github.com/paperless-ngx/paperless-ngx/blob/02b2f55248af1da43759ede68e44223516bd822e/src/documents/tests/test_api_trash.py>. It performs `DELETE /api/documents/<pk>/`, then `POST /api/trash/ {"action": "restore"}`, and asserts `status_code == 200`, `Document.objects.count() == 1`, `Document.deleted_objects.count()`, and that `GET /api/trash/` count returns to 0. It is a complete, unchanged, passing round-trip over exactly the buggy path.
- **Absent assertion:** that the restored document is searchable — `self.client.get("/api/documents/?query=shop").data["count"] == 1`. The fix added `test_search_after_restore_from_trash` to `src/documents/tests/test_api_search.py` and made `TrashView` re-add restored docs through `get_backend().batch_update()`.
- **Regression class:** **C** (conflicting sources: the relational row says restored, the Tantivy index says absent) plus **F** (the index write that the application implied simply never happened). This is the multi-source contradiction the MVP plan's demo minute 2:00–2:30 asks for, and it is real rather than injected.
- **Why it is the best finding:** it satisfies Tier 1 *and* Tier 2, the symptom is persisted-state/side-effect rather than visual, the pre-existing test genuinely exercised the path and passed, and the evidence requires correlating two different stores rather than diffing one.
- **Unverified:** I have not confirmed that `test_api_trash` passes at the pinned parent, nor that the Tantivy index is writable and queryable in a bare local run without the Docker services, nor that the selected tests import cleanly without the OCR system binaries.

### P2 — Bulk delete orphaned document versions in the trash (Tier 1 + Tier 3)

- **Fix PR:** <https://github.com/paperless-ngx/paperless-ngx/pull/14030>; **fix commit** `8d1bc5dd24dd6bd5ed5a702e84b8e2c140b16671`, 2026-09-09; **pin parent** `43a8d7d412b5caacee3f29a257ae3671a23d639a`.
- **PR text (Tier 2-adjacent):** *"Noticed while working on an un-related thing, it's not obvious which is I suspect why it hasn't been reported, happens if eg you bulk-delete a root and then try to restore it."* Upstream is stating outright that the defect shipped and stayed invisible.
- **Pre-existing test:** `src/documents/tests/test_bulk_edit.py::TestBulkEdit::test_delete_root_document_deletes_all_versions`. It asserted only that both the root and the version disappear from `Document.objects`.
- **Absent assertion:** the restore round-trip. The fix appended `Document.deleted_objects.get(id=self.doc1.id).restore(strict=False)` followed by `assertTrue(...exists())` for *both* rows, because root and versions had been soft-deleted under different `transaction_id`s and django-softdelete therefore would not restore them together. It also fixed `TrashView.queryset` so a version is no longer listed separately while its root is in the trash.
- **Regression class:** **B** (soft-deleted rows in an unrestorable state) plus **E** (the orphans leak into the trash listing and into later restores).
- **Note:** the absent assertion is appended to an existing method with no fixture change, so this is close to Tier 1a; the only reason it is not the headline is that the defect surfaces on a *second* operation (restore) rather than within the originally covered one.

### P3 — New document version was created with no owner (Tier 1a)

- **Fix PR:** <https://github.com/paperless-ngx/paperless-ngx/pull/14016>; **fix commit** `3899e0f0d664df665489baa13e4cc4a25c07aaae`, 2026-09-06; **pin parent** `d6485268587ede1c13ef97f67ad2072ba8a944cc`.
- **Pre-existing test:** `src/documents/tests/test_api_document_versions.py::TestDocumentVersioningApi::test_update_version_enqueues_consume_with_overrides`, which already asserted `input_doc.root_document_id`, `input_doc.source`, `overrides.version_label` and `overrides.actor_id`.
- **Absent assertion:** `self.assertEqual(overrides.owner_id, self.user.id)` — the only test-side line in the fix. Application side was one line: `overrides.owner_id = request.user.id`.
- **Regression class:** **B**, with a permissions consequence (an owner-less document behaves differently under paperless's object permissions).
- **Also noted:** `ca512af5ec5771deb0a536e94bad402367d48cc4` (`remove_inbox_tags` did not remove nested inbox children — lost/retained associations, class B) and `7330c4d9cb61f536fcd896b736e22375089d8e2a` (bulk edit "all" swept version documents — a cascade that touched too much).

---

## 3. pretix — closest structural twin of the Linkding harness

`pretix/pretix`. Server-rendered Django control panel and presale, pytest +
pytest-django, SQLite **and** Postgres in CI, and an e2e suite that is
**pytest + Python Playwright driven off pytest-django's `live_server`
fixture** — the same libraries and the same sync API our Linkding collector
already wraps.

- CI: <https://github.com/pretix/pretix/blob/1aea5633ebffeb6fef849657eab2e421dfdad0b8/.github/workflows/tests.yml> (main job `py.test ... tests --ignore=tests/e2e`; separate `e2e` job)
- e2e fixtures: <https://github.com/pretix/pretix/blob/1aea5633ebffeb6fef849657eab2e421dfdad0b8/src/tests/e2e/conftest.py> (`from playwright.sync_api import Browser, BrowserContext, Page, expect`, `live_server` fixture, ORM fixtures under `@scopes_disabled()`)

The e2e suite is only four files (`test_widget_button.py`,
`test_widget_journey_single.py`, `test_widget_journey_series.py`, plus
`conftest.py`) and it covers the embeddable ticket widget. Notably, its
assertions are **purely visual** — `expect(iframe.locator('text=/250\\.00/')).to_be_visible()`
and similar price checks in `test_full_purchase_journey` and
`test_journey_with_variations`. Nothing in those tests asserts a `CartPosition`
row, a `Quota` hold, or any persisted state. That is a textbook Beyond Green
target shape, but I found **no historical bug tied to those specific tests**, so
using them would mean injected mutations rather than held-out history.

### X1 — Cloning an event across organizers linked another tenant's meta property (Tier 1)

- **Fix commit:** `4c373518d0b3168aa70c46097199e7fd263b8ef1` — "Fix event meta property handling when cloning across organizers (Z#23231419) (#6306)", 2026-06-23. <https://github.com/pretix/pretix/commit/4c373518d0b3168aa70c46097199e7fd263b8ef1>
- **Pin this revision (buggy):** `1521c0cfcd0a28ee456d0ce878f17f080d4529fa`
- **Pre-existing test:** `src/tests/base/test_event_clone.py::test_full_clone_cross_organizer_differences` — an existing, named, passing test for exactly the cross-organizer clone path.
- **Absent assertions:** five, added by the fix, all of the form `copied_event.meta_values.get(...).property.organizer == organizer2`. `Event.copy_data_from` re-pointed `EventMetaValue` rows at the new event but left `emv.property` pointing at the *source* organizer's `EventMetaProperty`. The fix additionally added a `ValidationError` guard in `EventMetaValue.save()` — an upstream admission that the invalid cross-tenant state had been writable all along.
- **Regression class:** **B**, with a multi-tenancy dimension: a row in tenant B referencing tenant A's configuration object.
- **Tier 2 hint:** the `Z#23231419` prefix is pretix's customer-ticket convention, so this reached a paying user.
- **Honest caveat:** the fix had to add meta properties and meta values to the fixture, so the unchanged test at the buggy revision does not produce the bad rows. Fixture extension required, like H4.
- **Also noted:** `5522d67f9b270cc372d6f2a9678cd165030eca43` ("API: Fix old meta values being returned when updating event", fixes #5077) — a stale-read/conflicting-sources shape worth a follow-up pass.
- **Not surveyed:** pretix's order/quota/voucher domain is the richest source of stale-aggregate bugs among all candidates (`Quota.availability` caching, order state transitions). I scanned only for assertion-only fix commits since 2024-06 and did not work this area up.

---

## 4. Redmine — real bug tracker, real cascade bugs, entirely new collector

`redmine/redmine`. Rails 8.1, server-rendered ERB, Minitest across
`test/unit`, `test/functional`, `test/integration`, plus 28 Capybara/Selenium
system-test files under `test/system` with a dedicated `system-tests` CI job.
SQLite3, Postgres and MySQL all in the matrix. Issues live at
`https://www.redmine.org/issues/<n>` and are referenced from commit subjects.

- CI: <https://github.com/redmine/redmine/blob/e8515b4d2c871e2c0360cb346d530f28e285378a/.github/workflows/tests.yml>
- System test base (`driven_by :selenium, using: :chrome`): <https://github.com/redmine/redmine/blob/e8515b4d2c871e2c0360cb346d530f28e285378a/test/application_system_test_case.rb>

### R1 — Deleting an issue custom field left orphaned workflow permission rows (Tier 1 + strong Tier 3 signal)

- **Issue:** <https://www.redmine.org/issues/44366>
- **Fix commit:** `be05562f7be9a01e31d74e8acc7b3fe8637ae5da`, 2026-09-07 (svn r25051). <https://github.com/redmine/redmine/commit/be05562f7be9a01e31d74e8acc7b3fe8637ae5da>
- **Pin this revision (buggy):** `26712e67a3b832664d52a845d1c606751373f6de`
- **Application change:** added `before_destroy :delete_workflow_rules` to `app/models/issue_custom_field.rb`, deleting `WorkflowPermission` rows whose `field_name` is the custom field's id (a string-typed soft reference, so no FK constraint ever caught it).
- **The strongest part of this finding:** the same commit ships a data-repair migration, `db/migrate/20260827002435_delete_orphaned_workflow_rules_of_custom_fields.rb`, which sweeps orphans out of existing installations. Upstream is asserting that production databases had silently accumulated these rows for an unknown period.
- **Pre-existing coverage:** `test/unit/issue_custom_field_test.rb` existed and passed; the fix added `test_destroy_should_delete_workflow_rules`, which asserts `WorkflowPermission.where(field_name: field.id.to_s).count` goes from 1 to 0 after `field.destroy`.
- **Regression class:** **B** (orphaned rows after a cascade that under-deleted), with an **E** flavour — leftovers alter later workflow-permission evaluation.
- **Honest caveat:** Tier 1, not 1a — a new test method, not a strengthened one. Whether an *unchanged* pre-existing test destroys a custom field that has workflow rules attached is unconfirmed; `test/functional/custom_fields_controller_test.rb` has destroy coverage that I did not inspect.

### R2 — `Journal.updated_by_id` left pointing at a deleted user (Tier 1)

- **Issue:** <https://www.redmine.org/issues/41572>
- **Fix commit:** `a253cd163678b3fa6e3d73370f517656b0f7df1b`, 2024-10-29 (svn r23169). **Pin parent:** `48a7fd50cb491e590479e9a4455c0fc5a3fe69ac`.
- **Application change:** one line in `User#destroy`'s substitution block — `Journal.where(updated_by_id: id).update_all(updated_by_id: substitute.id)`. The neighbouring `user_id` reassignment had been there all along.
- **Pre-existing test:** `test/unit/user_test.rb::UserTest#test_destroy_should_update_journals`, which asserted `assert_equal User.anonymous, issue.journals.first.reload.user` and nothing about `updated_by`.
- **Absent assertion:** `assert_equal User.anonymous, journal.updated_by`.
- **Regression class:** **B** — a dangling reference in the audit trail after account deletion, i.e. a GDPR-adjacent failure that no assertion covered.
- **Honest caveat:** the fix had to add `journal.update_columns(updated_by_id: 2)` to the fixture because `init_journal` does not populate that column, so the unchanged test does not trigger the defect. Fixture extension required.
- **Also noted:** `60de97a2fcaad98219984362e205536a686dc59e` (deleting a user who authorised an OAuth2 application raised `ActiveRecord::InvalidForeignKey` — a loud crash, so less interesting for us) and `aef12fbe49f8e50704685e052da503ebae814e8c` / `e06b4a8435b2aebb20b6b8aba8a7973635c45166` (`CookieOverflow` when deleting a role or tracker used by many projects — a state-leakage-into-session shape, class E).

---

## 5. Rejected and deprioritised, with reasons

- **Discourse** — 540 files under `spec/system` is the richest browser suite in the domain, and RSpec + Capybara + a real Postgres would give excellent evidence. Rejected for the MVP window only: Postgres + Redis + Sidekiq + an Ember build puts the first green run well past 30 minutes, and it needs the same new Ruby collector as Redmine. Revisit after two working benchmarks exist.
- **Mealie** — FastAPI + SQLAlchemy with a Nuxt SPA. Out of the stated Django/Rails/Laravel domain and not server-rendered. The pytest skeleton would transfer but the Django ORM snapshot would not, so it costs roughly what pretix costs while fitting the domain worse.
- **Monica** and **Firefly III** — both Laravel, both with `tests/Feature` + `tests/Unit` and **no** `tests/Browser` directory, i.e. no Dusk browser suite. Laravel Feature tests would give HTTP + `assertDatabaseHas`-style integration evidence, which is the same evidence class Healthchecks already gives us at a fraction of the onboarding cost, and it would add a third language runtime. Monica's last upstream push was 2026-04-24, so it is also the least actively maintained candidate. Deprioritised rather than rejected: if a Laravel case is needed for stack diversity, Firefly III is the more active of the two.
- **Weblate** — Django with a real `weblate/trans/tests/test_selenium.py`, but heavy infrastructure (Postgres, Redis, large dependency set). Worth a look only if pretix's Playwright suite disappoints.
- **NetBox** — Django, but a tree scan found no Selenium/Playwright/e2e paths at all. No browser suite, so no advantage over Healthchecks.

---

## 6. Harness reuse against the existing Linkding collector

The Linkding harness has five separable parts. What transfers:

| Harness part | Healthchecks | paperless-ngx (pytest suite) | pretix | Redmine |
|---|---|---|---|---|
| `run.py`: pin/verify revision, install locked deps, run one selected test, hash artifacts, accept/reject | Reusable; swap `uv sync`/`npm ci` for `pip install -r requirements.txt -r requirements-dev.txt`; drop the asset build | Reusable nearly as-is (`uv run --dev --frozen pytest`) | Reusable (`uv pip install -e ".[dev]"`, plus `make all compress` if a presale/e2e test is selected) | Rewrite in/around `bundle exec rails test` |
| `beyond_green_settings.py`: settings overlay over upstream dev settings | `from hc.settings import *` | `from paperless.settings import *` | `from tests.settings import *` / `pretix.testutils.settings` | No analogue; Rails `config/environments/test.rb` + `database.yml` |
| pytest plugin loading (`-p`, `--ds`, `--junitxml`) and the report/exit-status hooks | Needs pytest + pytest-django added **on our side** (upstream runs `manage.py test`); pytest collects `django.test.TestCase` subclasses fine | Direct reuse | Direct reuse | None; needs a Minitest plugin |
| ORM snapshot taken before teardown | Same technique, new target: wrap `hc.test.BaseTestCase._post_teardown` instead of the Linkding browser helper's `tearDown`. New projections: `Check`, `Flip`, `Channel`, `Notification`, `Profile` | Same technique; wrap the shared `APITestCase`/`DirectoriesMixin` teardown. New projections: `Document`, `Tag`, `CustomFieldInstance`, `deleted_objects` | State comes from the `db` fixture, so snapshot from a `pytest_runtest_teardown` hookwrapper (pre-yield) or an autouse fixture ordered after `db`, before finalizers roll back | New Ruby collector: prepend `after_teardown` to snapshot before the transactional rollback, then write JSON |
| Playwright context observers (requests, responses, console, weberror, tracing) | **Does not apply** — no browser. Replace with a `django.test.Client.request` wrapper for HTTP evidence and an `hc.api.transports.HttpTransport.request` wrapper for outbound notification evidence | Does not apply to the pytest suite (DRF test client instead). The TS Playwright suite would need a separate TS-side collector | **Direct reuse** — same `playwright.sync_api` sync contexts, same `context.on(...)` and `context.tracing` calls | No equivalent; Selenium has no Playwright tracing. Would need CDP logging or a proxy |

**No candidate reuses the collector unchanged.** The honest summary:

- **pretix** is the only candidate where the *Playwright* half transfers verbatim, which makes it the closest structural twin — but its browser suite is four widget files and carries no historical gap I found.
- **Healthchecks** and the **paperless-ngx pytest suite** reuse everything except the browser observers, which is the larger share of the harness by volume: the runner, the settings overlay, the plugin mechanism, the JSON evidence writers, the snapshot-before-teardown technique, and the accept/reject validator scaffolding. Estimated collector work: a few hours each, not days.
- **Redmine** and **Discourse** need a new collector in a third language, plus a new network-capture strategy. Estimated: days.

---

## Not verified

Every item below is an unverified inference or an unchecked assumption. None of
these applications was installed, built, migrated, seeded, or run; no test was
executed; no database was snapshotted; no mutation was applied.

1. **No test was run anywhere.** Every claim that a named pre-existing test
   "passed while the defect was present" is inferred from the fix commit's diff
   (the maintainer added or changed an assertion in that file), not observed.
2. **No pinned revision was checked out and built.** All setup-cost figures are
   estimates from `requirements.txt`, `pyproject.toml`, `Gemfile` and CI
   workflow files, not from a timed installation.
3. **Healthchecks H1/H2/H4/H5:** I have not confirmed the named tests pass at the
   pinned parent revisions, that `pycurl` builds on the target host, or that
   pytest + pytest-django can collect `hc.test.BaseTestCase` subclasses without
   upstream changes. The claim that `Check.code` is a usable ping-URL capability
   secret is read from the model definition and `Check.unique_key`'s derivation,
   not demonstrated by issuing a ping.
4. **Healthchecks outbound-payload evidence:** the transports are mocked with
   `@patch("hc.api.transports.curl.request")`. I have not confirmed that
   wrapping `HttpTransport.request` observes the payload above the test's patch
   point without editing upstream files.
5. **Healthchecks H1 family has no linked issue or advisory.** I searched and
   found none; the evidence is commits plus CHANGELOG entries. Do not describe it
   as a reported vulnerability.
6. **Healthchecks H3 (pause):** at the buggy revision no unchanged upstream test
   exercises the already-paused path. I did not exhaustively grep the pre-fix
   tree for another test that pauses twice.
7. **Healthchecks H4 (clone) and pretix X1 and Redmine R2:** the fix commits
   extended fixtures, so the unchanged test at the buggy revision probably
   produces no observable state difference. Unconfirmed, and it would need to be
   checked before any of these three is used without a fixture change.
8. **Healthchecks H2 and H5 are requirement drift, not assertion gaps.** The
   pre-existing tests asserted the old intended behaviour. Using them requires
   feeding the later upstream behaviour to the agent as a requirement.
9. **paperless-ngx P1:** unconfirmed that `test_api_trash::test_api_trash` passes
   at `02b2f55248af1da43759ede68e44223516bd822e`, that the Tantivy index is
   writable and queryable in a bare local run, that the selected test modules
   import without tesseract/ghostscript/unpaper present, and that `uv sync --dev
   --frozen` completes within any useful time budget given `torch~=2.13.0`,
   `sentence-transformers` and the `llama-index-*` set.
10. **paperless-ngx browser suite:** I read `backend.py` and `playwright.config.ts`
    but did not run them, so "real disposable backend with a seeded SQLite
    database" is a reading of the source, not an observation.
11. **pretix:** unconfirmed that `tests/base/test_event_clone.py` runs on SQLite
    without `make all compress`, and unconfirmed that the e2e widget tests run
    without a Postgres service and an npm widget build. Its order/quota/voucher
    area — probably the richest source of stale-aggregate bugs in the whole
    survey — was not scanned.
12. **Redmine R1:** unconfirmed whether any *unchanged* pre-existing test
    (e.g. in `test/functional/custom_fields_controller_test.rb`) destroys a
    custom field that has workflow permissions attached. Without that, R1 needs a
    new caller or an injected mutation.
13. **Redmine collector feasibility:** the proposed "prepend `after_teardown` to
    snapshot before the transactional rollback" is a design sketch. Rails system
    tests share a connection with the Capybara server and I did not verify the
    ordering, nor that it works without editing `test/application_system_test_case.rb`.
14. **Regression-class letters are my mapping** onto section 9 of the MVP plan,
    not upstream's characterisation. Several findings straddle two classes and I
    have said so where that is the case.
15. **Discourse, Mealie, Monica, Firefly III, Weblate and NetBox** were assessed
    from repository metadata and directory listings only. Their bug histories
    were not scanned, so "no strong candidate" means "none found in a shallow
    pass", not "none exists".
16. **Commit scans were filtered and are not exhaustive.** I looked for fix
    commits that modify both application code and a pre-existing test file, then
    narrowed to commits whose test-side diff adds assertions without adding a new
    test method. Windows scanned: Healthchecks and Redmine from 2022–2023
    onward, paperless-ngx from 2023-06, pretix from 2024-06. Better findings
    plausibly exist outside those filters.
