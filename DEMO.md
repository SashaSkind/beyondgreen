# Demo runbook

Three minutes, four commands, one terminal. The visual is the **loop**, not a
dashboard. [README](README.md) covers install and credentials; run
`npm run check && npm test` once beforehand.

Every command here makes billable TypeSafe calls except the capture step.

## Pre-flight, before the room

Capture a fresh clean/mutant pair. Free, about 40 seconds, no model calls:

```sh
npm run benchmark:linkding:mutation
```

It prints `clean_run` and `mutant_run` paths inside a `comparison.json`. Export
them, because every later command needs them:

```sh
CLEAN=<clean_run>
MUTANT=<mutant_run>
```

Confirm the headline fact holds in this capture — `final_screenshots_byte_identical`
is `true` and the mutant's `bookmark_count_after` is 8 against the clean 9:

```sh
python3 -m json.tool "$MUTANT/comparison.json" | grep -E "screenshots_byte_identical|bookmark_count_after|upstream_test_passed"
```

Then dry-run beat 2 once. It should print `regression` and exit 0.

## 0:00–0:20 · The problem

Show that the upstream test passes on the defective build. The test is
Linkding's own, unmodified:

```sh
grep -E "upstream_test_passed|regression" "$MUTANT/comparison.json"
```

Say: *this build deletes a bookmark instead of archiving it, and the project's
own browser test passes anyway. The final screenshots are byte-identical, so
the UI cannot tell you.*

## 0:20–1:20 · The loop

```sh
npm run investigate -- --run "$MUTANT" --baseline "$CLEAN"
```

Let the trajectory print and narrate it as it appears. It reliably shows the
Scout starting uncertain, the Critic refusing to conclude, two evidence
retrievals, and confidence climbing:

```
Scout: hypothesis=unknown (0.57)
Critic: assessment=insufficient (0.78), next_evidence=database_state
Evidence: database_state
Investigator: hypothesis=suspected_violation (0.62)
Critic: assessment=supported (0.31), next_evidence=operation_contract
Evidence: operation_contract
Investigator: hypothesis=suspected_violation (0.98)
Critic: assessment=supported (0.89), next_evidence=none
Verifier: verdict=regression (0.98), grounding=sufficient (0.99)
```

The beat to name out loud: **the Critic's 0.31 on the second round.** It said
"supported" but below the 0.8 threshold, so the loop kept investigating instead
of concluding. That is the self-correction, visible in one line.

## 1:20–2:00 · The finding

The verdict line, then the receipt path the command prints. Say: *no assertion
was added to the test. The contract came from the pinned upstream
implementation, and the verdict required both the database state and that
contract before it could be issued.*

## 2:00–2:30 · The harder case

A defect that preserves the bookmark count, so counting rows cannot find it —
the archive drops the bookmark's tag association. Use a suite capture:

```sh
npm run investigate -- --run <archive_clears_tags capture> --baseline <suite baseline>
```

Nine bookmarks before, nine after, HTTP 200, test green, and the loop still
reaches `regression` from the association rows.

## 2:30–3:00 · Weave and the comparison

Open the trace URL the command printed: every role, its typed answer, its
probabilities, the evidence retrievals, tokens, and latency. Then the
[provider comparison](docs/experiments/linkding-comparison.md) for the
TypeSafe/DeepSeek result and its stated limits.

Close on the plan's line: *247 tests passed. Beyond Green investigated what the
tests didn't.*

## Fallbacks

- **A live call fails.** Re-run the command; investigations are independent and
  take seconds. Have one completed receipt under `.scratch/investigations/` open
  in a second pane to read from instead.
- **The network is unavailable.** Present from a saved receipt and its Weave
  trace URL; both contain the full trajectory.
- **A verdict comes back `insufficient`.** Say so plainly — abstention is a
  designed outcome, and the engine refuses to confirm without both required
  evidence sources. Then re-run.
