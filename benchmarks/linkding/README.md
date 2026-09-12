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
errors, wrong test IDs, and missing phases cannot be accepted. This establishes
the clean baseline; the paired mutation experiment is described below.

## Archive-to-delete experiment

```sh
npm run benchmark:linkding:mutation
```

This command creates a separate local clone at the pinned revision under
`.scratch/linkding-mutants/`, reuses the installed Python environment and built
assets without package syncing, and changes exactly one line in the archive
view: `archive_bookmark(bookmark)` becomes `bookmark.delete()`. It then captures
fresh clean and mutant runs with the same external collector. The clean
checkout and existing run artifacts remain intact. The mutant checkout is
retained for inspection; reruns create a new one.

The comparison requires matching test, source revision, dependency locks,
collector/settings/runner hashes, runtimes, and initial snapshots (excluding
creation/modification timestamps). Both tests must pass without runtime or
collection errors. The mutant must lose exactly the requested active bookmark
and its tag associations, while preserving all other rows and tags. The clean
baseline validator must reject that evidence specifically because a row was
lost. `experiment_valid=true` means the injected defect was reproduced;
`application_correct=false` records the incorrect application behavior.

Verified pair on 2026-09-12:

- Clean run `20260912T212935Z-40073ab3`: test passed in 2.14 seconds, archive
  POST returned HTTP 200, and all nine bookmark rows remained.
- Mutant run `20260912T212939Z-24d8f643`: the same test passed in 1.55 seconds
  and the same POST returned HTTP 200, but only eight rows remained. Bookmark 2
  and one bookmark/tag association were deleted.
- The final screenshots were byte-identical. Both showed Bookmark 1 and
  Bookmark 3, so this final page view did not expose the lost record.

`comparison.json` in the mutant run directory links both evidence bundles;
`mutation.patch` records the exact source change. Mutation labels and the
comparison report are experiment ground truth, separate from the collector's
evidence. Keep those labels out of future model inputs.

This is a demonstrated **single-test assertion gap**, not a claim that the full
upstream suite misses the defect. The mutation harness identifies row loss
deterministically. A separate [live TypeSafe investigation](../../docs/experiments/linkding-typesafe.md)
now also identifies the regression through critic-selected evidence retrieval,
without receiving experiment labels. The two pytest timings are individual
durations, not a performance comparison.

Sources: [upstream test](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/tests_e2e/e2e_test_bookmark_page_partial_updates.py#L101-L110),
[browser helper](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/tests_e2e/helpers.py),
[archive behavior](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/services/bookmarks.py#L93-L98).

## Six-case comparison suite

Run `python3 benchmarks/linkding/suite.py` to capture a new six-case suite:

- Unchanged archive: clean reference.
- Archive followed by `refresh_from_db()`: harmless source-change control.
- Archive replaced by deletion: row and association loss.
- Archive followed by toggling the target's unread flag: unrelated field corruption.
- Archive followed by clearing its tags: association loss with unchanged row count.
- Archive followed by toggling another owner's unread flag: state change outside the requested bookmark and account.

Each variant gets a fresh checkout and test database. The selected upstream test
and assertions remain unchanged. Exact state validators establish ground truth
and reject extra changes; the suite also checks matching source, dependency,
collector, runtime, and initial-fixture provenance. Labels and artifact hashes
are written to `.scratch/suites/<id>/suite.json` only after all cases succeed.
An interrupted suite leaves `suite.partial.json`, which is not a completed suite.
These are four related defect patterns in one archive workflow, not four
independent applications or broad production-regression coverage.

All six cases passed the browser test on 2026-09-12. The three new defects and
the harmless control retained all nine bookmark rows. Validator checks run with
`python3 -m unittest discover -s benchmarks/linkding -p test_suite.py`.
