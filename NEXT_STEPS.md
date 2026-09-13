# Next steps

Submission is 2026-09-13. Phases 1–8 of the plan's build order are built,
tested, and committed. Phase 9 — the demo — is the work left.

Read the [README](README.md) for commands and measured results, and the
[provider comparison](docs/experiments/linkding-comparison.md) for what the
pilot does and does not establish, before changing the engine. This file adds
what neither records: the invariants that protect those results, and the
ordered work remaining.

## State

Codex built the engine on 2026-09-12 and stopped mid-handoff, out of usage,
before writing this file. Nothing is half-applied: the tree is clean, 42
TypeScript tests and 2 Python checks pass, and `npm run check` passes.

Receipts live under gitignored `.scratch/`, so the paths cited in the
experiment docs are invisible to anyone cloning the repo.
[linkding-comparison-results.json](docs/experiments/linkding-comparison-results.json)
is the committed copy of both studies.

## Invariants

Each is deliberate. Breaking one invalidates the recorded results rather than
failing a test.

- **Ground truth never reaches a judge.** Case IDs, expected verdicts, mutation
  patches, local paths, and harness validators stay outside model state; Weave
  receives labels only after an investigation returns. The evaluator hashes
  every artifact before and after each run to establish that both providers saw
  the same captured evidence.
- **A verdict requires both `database_state` and `operation_contract`.** Engine
  policy, not model behaviour ([engine.ts:86](src/investigation/engine.ts#L86)).
  Confidence alone never confirms a finding.
- **Neither adapter retries.** A retry on one provider breaks the symmetry the
  comparison rests on. Put any retry behind a demo-only flag and record it in
  the receipt.
- **Billed cost stays null; estimates carry their source.** No invoice reaches
  this harness, so `costUsd` is always null. An estimate may be reported only
  through [cost.ts](src/cost.ts), which records the rate it used and who
  published it, and a provider with no rate reports no cost rather than zero.
- **The upstream browser test and its assertions stay unmodified.** The claim is
  that a real test misses the defect; editing the test forfeits the claim.

## Agent steps

1. [x] **Publish the work.** The public repo showed only the baseline while the
   engine, suite, and comparison sat unpushed. Done when
   `git rev-list --count origin/main..main` returns 0.
2. [x] **Prove the demo path.** A fresh pair investigated twice: both runs
   printed the full trajectory, exited 0, and verified a 9-step Weave trace.
   Uncovered the validator bug below; after that fix, 18 of 18 traced runs
   reached a verified verdict, including 6 of 6 `clean` on the control.
3. [x] **Write the demo runbook.** [DEMO.md](DEMO.md) carries the four commands,
   the beat each lands, and fallbacks for a failed call or a dead network.
4. [x] **Slides drafted.** Two published slides — the hidden regression, then
   the economics — alongside a published explainer page carrying the loop
   diagram, the model-state boundary, a real nine-step trajectory and the
   measured table. Both are private artifacts on claude.ai; ask Sasha for the
   links, and reuse their figures rather than inventing new ones.
5. [x] **The cost gap is closed.** No public page carries a TypeSafe rate —
   `typesafe.ai/pricing` returns 404 and the
   [API reference](https://docs.typesafe.ai/api.md) documents no billing — but
   the account's own usage dashboard states $0.042 per million input tokens with
   output not billed. [cost.ts](src/cost.ts) holds that rate with its
   provenance, and the evaluator now reports an estimated cost per
   investigation: $0.00054 for TypeSafe against about $0.06 for DeepSeek.
   Keep billed cost null; only estimates are available, and DeepSeek's comes
   from Weave rather than from its provider.
6. [x] **The TypeSafe validation failure is root-caused and fixed.** Providers
   round probabilities to two decimals, so a well-formed distribution can sum to
   0.99; the validator allowed only 0.001 of drift. Replaying a saved payload
   never reproduced it, because the trigger is the sampled probabilities rather
   than the input — which is why 25 earlier replays came back clean. Traced runs
   failed 3 of 8 before the fix and 0 of 18 after.
7. [x] **DeepSeek's truncation did not recur.** It resolved
   `archive_deletes_bookmark` in both studies after the validator fix. Since the
   engine records every judge failure as `model_error`, the receipts never
   separated a rounding rejection from a truncated response, so the earlier
   attribution to the token budget was not established. Watch for
   `finish_reason=length` returning; the deletion case sends the largest
   snapshots and would truncate first.
8. [x] **Comparison re-recorded.** Two fresh studies on the unchanged suite, one
   at the corrected diagnostic labels. TypeSafe 4/6 twice with the same two
   abstentions; DeepSeek 6/6 twice; no incorrect verdict or false positive in 24
   investigations. Weave prices DeepSeek at about six cents per investigation and
   has no rate for `jev-1.13.0`. All four studies are in
   [linkding-comparison-results.json](docs/experiments/linkding-comparison-results.json).
9. [x] **Held-out historical cases found.** Five domain reviews across roughly
    thirty applications; the decision is in
    [benchmark-selection.md](docs/research/benchmark-selection.md#second-round-held-out-historical-cases).
    Documenso #2485 leads: a user-reported bug that shipped, whose existing
    Playwright spec already reads the corrupted row and asserts the wrong two
    columns. Nothing has been executed, so every case is still a candidate.
10. [x] **One held-out case is proven.** Documenso #2485 reproduced end to end:
    the unchanged upstream tests pass on both the defective and fixed builds,
    and only the defective one leaves recipient rows claiming a signing request
    was sent with no job and no mail behind them. See
    [documenso-held-out.md](docs/experiments/documenso-held-out.md). The premise
    that a pre-existing test passes on defective code is now observed, not
    inferred.
11. [ ] **Write the Documenso collector** so the investigator can actually read
    that capture. It needs HTTP recording and a Postgres snapshot before
    teardown, normalised into the shape
    [evidence.ts](src/investigation/evidence.ts) expects, plus a contract for
    "send a signing request to the dictated next signer". Until then the gap is
    proven but undetected, which is the honest state to report.

## Human steps

- Record the screen capture, under 2 minutes, and rehearse the 3-minute demo.
- Complete the project description, team list, and participant surveys.

## Stretch, once the demo is finished

- **An independent held-out workflow.** The comparison doc names non-held-out
  cases as its main limitation: four mutations of one workflow are not four
  regression classes. Vendure is already selected and pinned in
  [benchmark-selection.md](docs/research/benchmark-selection.md).
- **Cross-run investigation memory**, so evidence selection improves across
  investigations rather than only within one.
