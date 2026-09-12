# Linkding archive baseline

This harness runs the existing archive partial-update browser test from the
Linkding revision in [manifest.json](manifest.json). Linkding is an upstream
application/test dependency; the runner and evidence collector are Beyond Green
code. The product backend remains TypeScript; this collector is Python because
Linkding's existing test suite uses Django and Python Playwright.

## Run

Requires macOS or Linux, Node.js, Python 3.11+ for the runner, Git, and
[uv](https://docs.astral.sh/uv/). Setup uses Python 3.14.6 for Linkding itself
and its locked Python/npm dependencies. Chromium is installed through the
locked Playwright package. Linux may additionally require browser system
libraries; use Playwright's documented OS-dependency installation for the host.

```sh
npm run benchmark:linkding:setup
npm run benchmark:linkding
```

Setup creates `.scratch/linkding`. It refuses a different source revision or
tracked changes or untracked source files instead of resetting them. Each baseline run starts a temporary
Django test database and an isolated Huey queue. It does not start a worker,
matching the selected upstream test's execution model. No model calls are made.

The collector is loaded as an external pytest plugin. It temporarily wraps the
upstream browser helper at runtime, restores it afterward, and never edits its
files or assertions. A settings overlay changes only the Huey queue's path.

## Evidence

Each run writes `.scratch/runs/linkding/<run-id>/`:

- `run.json`: revision, source/lock/collector hashes, invocation, acceptance
  checks, and artifact hashes.
- `database-before.json`: bookmarks, tags, and associations after fixture
  creation but before the browser opens.
- `database-after.json`: the same projections before Django clears the test DB.
- `evidence.json`: timestamped HTTP/browser/database/log events, actual pytest
  outcomes and runtimes, and collection errors.
- `junit.xml` and `pytest.log`: upstream test result and process output.
- `browser-0.zip` and `page-after.png`: Playwright trace and final screenshot,
  including for passing runs.

The JSON HTTP collector records paths, methods, selected action fields, and
response statuses. It excludes cookies, authorization headers and CSRF values.
The local Playwright trace may contain synthetic test-session data; raw run
artifacts are ignored by Git. Only messages actually emitted by the app are
logged; successful archive actions may produce no application log events.

Acceptance requires the exact selected test to pass, no collection or captured
runtime errors (including HTTP errors), complete browser
artifacts, an observed archive POST/HTTP 200 exchange, and independent database
checks: preserve all bookmark IDs and tag relationships, archive the requested
row, and allow only its archive flag and modification time to change. These
checks establish a known-good baseline; they are not an AI regression detector.
Timeouts and interruptions stop the test process group and leave a rejected
run manifest.

## Verified result

On 2026-09-12 the unchanged upstream test passed, then passed with this
collector. Captured evidence preserved nine bookmark rows, changed bookmark 2
from `is_archived=false` to `true`, preserved tag associations, and recorded
HTTP 200 for `POST /bookmarks/action`. The initial captured run is
`20260912T211644Z-46fba35b`; the final hardened runner also passed in 2.05 seconds
as `20260912T212052Z-879ee993`. Rejection checks verified browser/collection
errors, wrong test IDs, and missing phases cannot be accepted. This proves the clean baseline only; the deletion
mutation and AI investigation are subsequent work.

Sources: [upstream test](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/tests_e2e/e2e_test_bookmark_page_partial_updates.py#L101-L110),
[browser helper](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/tests_e2e/helpers.py),
[archive behavior](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/services/bookmarks.py#L93-L98).
