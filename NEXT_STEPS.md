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
2. [ ] **Prove the demo path.** Capture a fresh clean/mutant pair, then run the
   investigation on it twice. Done when both runs print the full role
   trajectory, exit 0, and report a verified Weave trace. Makes billable model
   calls.
3. [ ] **Write the demo runbook.** Exact commands in order, the beat each one
   lands from the plan's 3-minute script, and a fallback for a failed live model
   call. Done when someone can run the demo from the file alone.
4. [ ] **Draft the slides**, two at most: the problem, the loop, the finding,
   the comparison.
5. [ ] **Close the cost gap.** Find a published TypeSafe rate and compute
   per-investigation cost for both providers. Absent a rate, record that no
   comparable rate exists and keep latency and tokens as the economic evidence.
   H3 — that cheap intelligence makes exhaustive investigation practical — is an
   economic claim, and latency is currently its only support.
6. [ ] **Reduce demo risk on the two open failures.** DeepSeek exhausts its
   8,192-token budget on `archive_deletes_bookmark`; shrink the state payload
   before raising the budget again. One TypeSafe response-validation failure
   never reproduced across 25 bounded replays, so treat it as a live flake the
   demo must survive.

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
