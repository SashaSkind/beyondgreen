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
- **`costUsd` stays null while no comparable rate exists.** Reporting zero
  asserts a measurement nobody made.
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
4. [ ] **Draft the slides**, two at most: the problem, the loop, the finding,
   the comparison.
5. [ ] **Close the cost gap.** Find a published TypeSafe rate and compute
   per-investigation cost for both providers. Absent a rate, record that no
   comparable rate exists and keep latency and tokens as the economic evidence.
   H3 — that cheap intelligence makes exhaustive investigation practical — is an
   economic claim, and latency is currently its only support.
6. [x] **The TypeSafe validation failure is root-caused and fixed.** Providers
   round probabilities to two decimals, so a well-formed distribution can sum to
   0.99; the validator allowed only 0.001 of drift. Replaying a saved payload
   never reproduced it, because the trigger is the sampled probabilities rather
   than the input — which is why 25 earlier replays came back clean. Traced runs
   failed 3 of 8 before the fix and 0 of 18 after.
7. [ ] **DeepSeek still exhausts its 8,192-token budget** on
   `archive_deletes_bookmark`. Shrink the state payload before raising the
   budget again; the deletion case sends the largest snapshots.
8. [ ] **Re-record the comparison.** The published numbers were measured under
   the too-strict validator, so some abstentions were parser artifacts rather
   than model behaviour. Re-run both providers on the unchanged suite and
   restate the results.

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
