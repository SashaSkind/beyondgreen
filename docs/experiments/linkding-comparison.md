# Linkding provider comparison

This development pilot tests two clean controls and four injected defects in
one pinned Linkding archive workflow. All six captures passed the same unchanged
upstream browser test. It is a reproducible investigation experiment, not a
held-out accuracy benchmark or evidence of broad model superiority.

## Captured cases

- `clean_archive`: unchanged source; retains nine bookmarks and archives target 2.
- `archive_refresh_control`: archives then refreshes the Python object from the
  database; harmless source change, same required persisted state.
- `archive_deletes_bookmark`: removes target 2 and its tag association; eight rows remain.
- `archive_toggles_unread`: archives target 2 but also flips its unread flag; nine rows remain.
- `archive_clears_tags`: archives target 2 but drops its tag association; nine rows remain.
- `archive_changes_other_owner`: archives target 2 but also flips bookmark 7's
  unread flag under another owner; nine rows remain.

Each source variant gets an isolated checkout and fresh test database. The suite
checks exact expected state, matching fixtures, runtime, test/collector hashes,
and dependency locks. It does not modify the browser test or its assertions.
The durable source fixture is [suite.py](../../benchmarks/linkding/suite.py).
The completed capture manifest is
`.scratch/suites/e60d5663305f4924b87aae48fd557411/suite.json`.
All six final screenshots were byte-identical (SHA-256
`3ed76c3e7089a31b524258388a7540dd98a6aa6cda5f6692091faa4dca1ffd79`).
The final browser view therefore did not distinguish these defects from either
clean control.

## Method

TypeSafe `jev-1.13.0` and W&B-hosted `deepseek-ai/DeepSeek-V4-Pro-0813` use the
same engine, initial observations, evidence catalog, contract, and typed
questions. Model-selected retrievals may differ. The archive contract explicitly
requires preservation of other bookmarks as well as target fields and tag
associations. Both must retrieve database state and contract before verification.

Case names, expected labels, mutation patches, and harness verdicts stay outside
model state. The evaluator checks capture hashes before and after each run and
records source hashes in its receipt. Weave receives labels for evaluation
scoring only after the investigation has returned. The models receive no scores
or other provider's responses.

Both use at most four critic rounds and a provisional 0.8 confidence threshold.
TypeSafe confidence is native distribution concentration. DeepSeek generates
self-reported probabilities and confidence, so those scales are not directly
comparable or established correctness probabilities. There are no retries.

## First pass: 4,096-token DeepSeek budget

The first pass ran each provider once per capture, alternating provider order:

- TypeSafe: 4/6 correct, 2/6 inconclusive. It confirmed deletion and tag loss and
  accepted both clean controls. The unread case hit response validation; the
  cross-owner case remained inconclusive after the Critic rejected the hypothesis
  and selected no more evidence.
- DeepSeek: 2/6 correct, 4/6 inconclusive. It confirmed tag loss and accepted the
  harmless source-change control. Four cases stopped on response validation.
- Neither provider issued an incorrect definitive verdict. That does not make
  abstentions successful detections: TypeSafe confirmed 2/4 defects and DeepSeek
  confirmed 1/4 under these settings.
- Mean investigation latency, including abstentions: TypeSafe 5.07 seconds;
  DeepSeek 48.04 seconds. These are single-pass measurements, excluding Weave
  initialization, flushing, and capture execution.

TypeSafe reported 69,952 input and 2,111 output tokens from parsed responses;
DeepSeek reported 32,805 input and 20,789 output tokens. Failed requests can
consume tokens without a parsed judgment, so these totals undercount billed
usage. They must not be treated as a cost comparison. `costUsd` remains null.

Receipt: `.scratch/evaluations/bbcc5075-e416-44f3-b6d7-3e6ad9fd6b1d/evaluation.json`.
All twelve investigation traces and both evaluation roots were read back from
Weave as completed. Failed child model calls are retained within inconclusive
investigations.

Useful traces:

- [TypeSafe detects tag loss](https://wandb.ai/as-skinderev/beyond-green/r/call/01a097b1-5c80-757e-a472-f1433ad574c3).
- [DeepSeek detects tag loss](https://wandb.ai/as-skinderev/beyond-green/r/call/01a097b0-62ad-72b7-9afb-84b2465190d3).
- [TypeSafe abstains on cross-owner corruption](https://wandb.ai/as-skinderev/beyond-green/r/call/01a097b1-7d0d-7083-8a16-c01bfdd9f5af).

## Diagnosis and follow-up

A bounded replay of a failed DeepSeek Critic request reproduced HTTP 200 with
`finish_reason=length`, exactly 4,096 completion tokens, and no usable final
answer. Other replays of the same request completed. This establishes that the
configured token budget can cause these failures; it does not prove that every
failure in the first pass had the same cause, because those raw responses were
not retained.

The adapter now allows 8,192 completion tokens and 90 seconds per request and
reports token-limit failures distinctly in Weave. Reasoning stays enabled; the
prompts and investigation policy remain unchanged. The first pass is retained.
The TypeSafe response-validation failure did not recur in 25 bounded diagnostic
requests; its exact cause remains unresolved and no speculative parser change
was made. Diagnostic requests are excluded from evaluation metrics and can incur
additional usage.

## Follow-up: 8,192-token DeepSeek budget

The completed follow-up uses the exact same six captures, questions, contract,
and engine. DeepSeek returned 5/6 correct verdicts and one inconclusive result:
both clean controls were accepted, and unread-flag corruption, tag loss, and
cross-owner corruption were confirmed. The deletion case still exhausted the
larger token budget. No incorrect definitive verdict was issued.

Mean investigation latency was 81.35 seconds, including the inconclusive case.
Successfully parsed responses reported 78,644 input and 51,230 output tokens;
the failed call's usage is absent from those totals. The follow-up is one new
sample per capture, not a replacement for the first pass. Both the budget and
timeout increased, and model sampling can vary, so the score difference cannot
be attributed solely to the token limit.

Receipt: `.scratch/evaluations/1e93d504-f42e-4e74-ad14-b478adcbf099/evaluation.json`.
The [follow-up Weave evaluation](https://wandb.ai/as-skinderev/beyond-green/r/call/01a097b5-13e7-799f-b4b1-e808b4d56c6a)
contains the per-case scores and aggregate results.
All six investigation traces and the evaluation root were read back from Weave
as completed. The [cross-owner finding](https://wandb.ai/as-skinderev/beyond-green/r/call/01a097ba-d82c-7573-93be-c85a9980c1f9)
is the useful contrast: DeepSeek confirmed that the archive action changed
another owner's bookmark, while TypeSafe's first pass remained inconclusive.

The [machine-readable results](linkding-comparison-results.json) preserve both
studies, their settings and code hashes, every case outcome, and trace links.
Weave has default-rate DeepSeek cost estimates for successful parsed calls, but
no TypeSafe rate was available. Those estimates exclude failed calls and
diagnostic replays and are not total billing; a provider cost comparison remains
unavailable.

## Limits

The cases were designed alongside the investigator and contract; they are not
held out. Four related mutations of one workflow are not four independent
regression classes across products. The clean controls cover only two examples.
Repeated model runs on these captures measure variability, not new application
coverage. The next evaluation should add independent workflows, more clean
controls, and pricing/failed-response usage accounting before making quality or
economic claims.

References: [W&B chat completions](https://docs.wandb.ai/inference/api-reference/chat-completions),
[W&B reasoning controls](https://docs.wandb.ai/inference/response-settings/reasoning),
[Weave EvaluationLogger](https://docs.wandb.ai/weave/guides/evaluation/evaluation_logger),
[pinned archive implementation](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/services/bookmarks.py#L87-L91).
