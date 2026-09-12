# Lightweight benchmark candidates

Researched 2026-09-12 against public upstream source. This is a static inspection; none of these applications was installed or run. Recommendations follow the MVP plan's priority: existing real application and passing E2E → one hidden regression → evidence collection.

## Recommendation: start with Linkding

**Linkding has the best fit among these three:** a compact Django bookmark product, Playwright browser tests, SQLite by default, and an existing GitHub Actions E2E job. Pin `sissbruecker/linkding` to **`eb98e67d942436b8ad0207dae5fd99a268463a0b`**. Its development instructions require Python 3.13, uv, and Node; no separate database server is needed. [README](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/README.md), [database settings](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/settings/base.py#L251-L283).

Static inspection counted **83 `test_` methods across 15 E2E files**, enough to choose 30–100 meaningful runs without creating a browser suite. This is a source count, not a verified collected/passing count. The suite covers forms, bulk operations, partial updates, tags, settings, and navigation. CI installs Chromium, builds static assets, and runs `uv run pytest bookmarks/tests_e2e -n auto -o "python_files=e2e_test_*.py"`. [E2E directory](https://github.com/sissbruecker/linkding/tree/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/tests_e2e), [CI](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/.github/workflows/main.yaml).

### First proposed regression: archive accidentally deletes

- **Existing test:** `bookmarks/tests_e2e/e2e_test_bookmark_page_partial_updates.py::BookmarkPagePartialUpdatesE2ETestCase::test_active_bookmarks_partial_update_on_archive`.
- **Existing assertions:** click Archive on Bookmark 2; remaining visible bookmarks are 1 and 3; visible tags are 1 and 3; no full reload. It does not assert the archived record still exists. [Exact test](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/tests_e2e/e2e_test_bookmark_page_partial_updates.py#L101-L110).
- **Mutation:** in `bookmarks/views/bookmarks.py::archive`, replace `archive_bookmark(bookmark)` with `bookmark.delete()`. The correct service sets `is_archived=True` and saves the row. **Inference:** both operations remove the item from the active list, so this selected test should remain green while the archive operation loses data. This must be demonstrated experimentally; other upstream tests may catch the mutation. [View](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/views/bookmarks.py#L255-L267), [correct service](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/services/bookmarks.py#L93-L98).
- **Evidence:** captured Archive HTTP request and successful partial response; pre/post bookmark and tag-relation snapshots; known-good baseline retaining the same primary key as archived; requirement derived from the correct archive implementation. Start Scout with the passing test plus coarse state-count difference, then let it request the targeted row and relationship evidence. Keep mutation identity and expected label outside model inputs.

A second candidate is forced `shared=True` in `create_bookmark`: the existing Ctrl+Enter submission test checks row count, URL, and description, but not sharing state. The model defaults `shared` and `default_mark_shared` to false. This demonstrates unwanted persisted sharing state; **do not claim actual public disclosure** without verifying the separate sharing configuration and access behavior. [Test](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/tests_e2e/e2e_test_new_bookmark_form.py#L303-L323), [model](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/models.py).

### Setup and evidence friction

Follow `make init`, then `make prepare-e2e`, and run the selected test serially before scaling. The E2E helper owns Django's `LiveServerTestCase` and Playwright contexts, so add evidence hooks around it without changing test assertions. Export ORM state before Django teardown; do not assume the development `data/db.sqlite3` is the test database. The helper currently captures screenshots only on failure and prints browser errors, so passing-run HTTP/trace capture is additional Beyond Green work. [Makefile](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/Makefile), [helper](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/tests_e2e/helpers.py).

Proposed first-run recipe, inside an isolated checkout of the pinned commit:

```sh
make init
make prepare-e2e
uv run pytest bookmarks/tests_e2e/e2e_test_bookmark_page_partial_updates.py::BookmarkPagePartialUpdatesE2ETestCase::test_active_bookmarks_partial_update_on_archive -o 'python_files=e2e_test_*.py'
```

The test starts its own Django live server and seeds/login its own user, so no separate `make serve` or interactive superuser creation is needed for this path. Validate browser/system dependencies on the execution host before calling the recipe reproducible.

Background work uses a separate SQLite Huey queue with `immediate=False`; CI does not start its consumer. Isolate/reset the queue between runs and avoid treating queued but unprocessed jobs as a regression in this baseline. Background-failure cases need a separately controlled worker experiment. Form tests already mock remote metadata; the archive test uses local seeded records. [Queue configuration](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/settings/base.py#L170-L188), [form fixture](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/tests_e2e/e2e_test_new_bookmark_form.py#L19-L31).

## Linkwarden: real Playwright, insufficient current coverage

Pin **`linkwarden/linkwarden@952ac4540657cae3a67c3ca59433899d2fda8374`**. Its current browser suite contains only four login cases, with CI's matrix restricted to `@login`. The success case only checks that the login form disappears and dashboard container appears. This is far less useful for 30–100 diverse cases. [Tests](https://github.com/linkwarden/linkwarden/blob/952ac4540657cae3a67c3ca59433899d2fda8374/apps/web/e2e/tests/public/login.spec.ts), [CI](https://github.com/linkwarden/linkwarden/blob/952ac4540657cae3a67c3ca59433899d2fda8374/.github/workflows/playwright-tests.yml).

Setup also requires PostgreSQL 16, Node 20/Yarn 4, Prisma generation/migrations, a web build, and the server/worker. The Playwright configuration has its automatic web-server launch commented out. A possible mutation area is the successful credentials `authorize` branch: wrong-account authentication might evade container-only assertions, but the existing fixture would need a second seeded account and identity evidence to make that a defensible experiment. This is a research lead, not a demonstrated benchmark. [Configuration](https://github.com/linkwarden/linkwarden/blob/952ac4540657cae3a67c3ca59433899d2fda8374/apps/web/playwright.config.ts), [authentication](https://github.com/linkwarden/linkwarden/blob/952ac4540657cae3a67c3ca59433899d2fda8374/apps/web/pages/api/v1/auth/%5B...nextauth%5D.ts#L61-L104).

## Karakeep: useful second application if API E2E is acceptable

Pin **`karakeep-app/karakeep@5a2f009e2f6d266087f2f3f527e6e384cefd6de4`**. Its existing E2E tests use **Vitest API/worker integration tests**, not a Playwright browser suite. GitHub Actions runs them and uploads Docker logs on failures. Its test Compose stack includes web, Meilisearch, Chrome, nginx fixtures, MinIO, and an AI mock service, so setup is materially heavier than Linkding. [Vitest configuration](https://github.com/karakeep-app/karakeep/blob/5a2f009e2f6d266087f2f3f527e6e384cefd6de4/packages/e2e_tests/vitest.config.ts), [CI](https://github.com/karakeep-app/karakeep/blob/5a2f009e2f6d266087f2f3f527e6e384cefd6de4/.github/workflows/ci.yml), [Compose](https://github.com/karakeep-app/karakeep/blob/5a2f009e2f6d266087f2f3f527e6e384cefd6de4/packages/e2e_tests/docker-compose.yml).

Concrete lead: `should manage tags on a bookmark` checks a successful DELETE response after tag removal, without reading the bookmark back. Skipping the `tagsOnBookmarks` deletion in the tag transaction could preserve the response while leaving the association behind. Verify this inference with the selected test and a post-request database query; other tag tests may catch it. Good second app for REST/DB contradictions, but it changes the initial browser-E2E framing. [Test](https://github.com/karakeep-app/karakeep/blob/5a2f009e2f6d266087f2f3f527e6e384cefd6de4/packages/e2e_tests/tests/api/bookmarks.test.ts), [transaction](https://github.com/karakeep-app/karakeep/blob/5a2f009e2f6d266087f2f3f527e6e384cefd6de4/packages/trpc/routers/bookmarks.ts#L1352-L1368).

## Decision boundary

Use Linkding for the first reproducible selected-test demonstration. Expand to additional independently seeded mutations and clean controls only after proving the baseline. Report which unchanged test(s) remain green; do not imply the entire upstream CI suite misses a mutation unless that full suite was run. Repeated runs measure reliability, but do not count as distinct defects or independent test scenarios.
