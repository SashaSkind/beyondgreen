# First TypeSafe investigation

On 2026-09-12, Beyond Green investigated the already captured Linkding pair
using real TypeSafe calls (`jev-1.13.0`). The selected upstream browser test
passed in both captures. TypeSafe returned `clean` for the unchanged operation
and `regression` for the archive-to-delete mutation.

This is one worked example with a clean control, not an accuracy benchmark.
The captures were reused; the investigation did not rerun or modify Linkding.

## Observed trajectories

Both investigations followed this model-selected sequence:

1. Scout: `unknown` from the passing test, observed archive request, and counts.
2. Critic: requests `database_state`.
3. Investigator: updates its hypothesis using actual before/after rows.
4. Critic: requests `operation_contract`.
5. Investigator: reassesses using the pinned archive behavior.
6. Critic: supports the revised hypothesis and requests no further evidence.
7. Verifier: checks the recorded state against that contract.

The clean investigation moved from `unknown` to `consistent`. It retained all
nine bookmarks and set bookmark 2's archive flag. Its final verdict was `clean`.
The model used 13,839 input tokens and 399 output tokens over seven calls;
the investigation took 5.41 seconds, excluding Weave initialization and flush.

[Clean Weave trace](https://wandb.ai/as-skinderev/beyond-green/r/call/01a09792-59e8-7820-9e21-7eb30bd0fba3).
Capture: `20260912T212935Z-40073ab3`.
Local receipt: `.scratch/investigations/915ad7e3-c609-4f69-99cd-f9d2c123fb0d/investigation.json`.

The mutation investigation moved from `unknown` to `suspected_violation`.
Bookmark 2 and its tag association disappeared, leaving eight bookmarks,
although the archive request returned HTTP 200 and the browser test passed.
The retrieved contract requires retaining the bookmark and setting its archive
flag. Its final verdict was `regression`. The model used 13,370 input tokens
and 406 output tokens over seven calls; the investigation took 5.34 seconds.

[Regression Weave trace](https://wandb.ai/as-skinderev/beyond-green/r/call/01a09792-91e5-7534-b36d-f3dd06d33bee).
Capture: `20260912T212939Z-24d8f643`.
Local receipt: `.scratch/investigations/e929dece-1540-404b-8dea-e1443c33b329/investigation.json`.

Both parent traces and all nine child calls per trace (seven model calls, two
evidence retrievals) were read back from Weave as completed without exceptions.
The optional known-good retrieval was available but neither model requested it.

## Evidence and boundaries

The loader reads only allowlisted fields from `evidence.json` and the two
database snapshots. It never reads mutation patches, comparison reports, or
the harness's correctness labels. Local paths and experiment names are absent
from model state. The archive contract is a fixed, source-derived fixture from
the pinned normal implementation, not an automatically inferred requirement.

Only model choices drive the current-run hypothesis and verdict. Deterministic
guards require both database and contract evidence, bound the loop to four
critic rounds, and abstain on failures or insufficient confidence. A separate
deterministic gate validates any supplied known-good reference before exposing
it as such. It does not classify the current run.

The Critic selected the contract even when its assessment tentatively said
`supported` after database retrieval. The engine's coverage requirement prevented
premature confirmation. This demonstrates evidence acquisition and revision
from uncertainty, not recovery from a confidently wrong initial diagnosis.

The 0.8 confidence threshold is provisional. TypeSafe confidence measures
distribution concentration, not an empirical probability that the verdict is
correct. No dollar-cost rate has been established, so `costUsd` is null. These
single-run timings do not establish comparative speed or economics.

The current 36 local tests cover retrieval and validation, label exclusion,
reference correctness, scripted revision, bounded execution, abstention, and
HTTP response handling. Scripted count-decrease and equal-count controls test
the engine's independence from row-count heuristics; they do not measure live
model reasoning. More real regression classes, held-out controls, repeated
evaluations, and the DeepSeek comparison are still needed.

Sources: [pinned archive implementation](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/services/bookmarks.py#L87-L91),
[TypeSafe HTTP API](https://docs.typesafe.ai/api.md),
[TypeSafe confidence](https://docs.typesafe.ai/confidence.md).
