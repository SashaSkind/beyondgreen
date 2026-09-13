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
requests, and was left unexplained at the time. It is now root-caused below.
Diagnostic requests are excluded from evaluation metrics and can incur
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

## Root cause of the response-validation failures

The two earlier passes attributed their abstentions to the models, or to
DeepSeek's response budget. Live sampling of `jev-1.13.0` established a
different cause. Providers report probabilities rounded to two decimals, so a
well-formed distribution can sum to 0.99 or 1.01, while the shared validator
admitted only 0.001 of drift. Across 62 sampled answers, 59 summed to exactly
1.00, and the three that summed to 0.99 were the three rejected responses. Every
rejected body was otherwise valid.

Replaying a saved request never reproduced this, which is why the 25 earlier
diagnostic replays came back clean: the trigger is the sampled probabilities,
not the request. Driving the engine against a fixed capture while recording raw
response bodies reproduced it in 3 of 8 investigations, and in 0 of 18 after the
tolerance was widened to half a rounding unit per option, with guard tests
retaining rejection of distributions too far from one to be rounding.

`parseJudgment` is shared, so this affected both providers, and the engine
records every judge failure as `model_error`. The receipts therefore cannot
separate a rounding rejection from a truncated DeepSeek response, and the
earlier attribution of DeepSeek's failures to its token budget is not
established by those receipts. One bounded replay did reproduce
`finish_reason=length`, so both causes were real; their relative share is
unknown.

## Corrected abstention reporting

Both surviving TypeSafe abstentions first reported `incomplete_evidence`
although the receipts show both required sources had been retrieved. The Critic
had failed the 0.8 gate — `supported` at 0.65 in one case, `refuted` at 0.46 in
the other — and then asked for no further evidence, which the engine reported as
missing evidence. The reason now distinguishes `critic_unconvinced` from a
genuinely missing source and from a reselected key. Study three predates that
label and study four uses it; the verdicts are identical.

## Studies three and four: after the validator fix

Both studies use the same six captures, questions, contract, engine, four-round
limit and 0.8 threshold. Study four additionally runs at the corrected
diagnostic labels. Each is one sample per capture per provider.

| Two runs | TypeSafe `jev-1.13.0` | DeepSeek-V4-Pro-0813 |
|---|---|---|
| Correct verdicts | 4/6 · 4/6 | 6/6 · 6/6 |
| Abstentions | 2 · 2 | 0 · 0 |
| Incorrect verdicts | 0 · 0 | 0 · 0 |
| False positives on controls | 0 · 0 | 0 · 0 |
| Mean latency | 5.32 s · 6.11 s | 92.54 s · 78.79 s |
| Input tokens per investigation | 12,950 | 15,585 · 16,193 |
| Output tokens per investigation | 382 · 382 | 11,229 · 9,923 |
| Estimated cost per investigation | $0.00054 | $0.0649 · $0.0605 |

TypeSafe abstained on exactly `archive_toggles_unread` and
`archive_changes_other_owner` in both runs, for the same reason, with both
required sources in hand. It confirmed deletion and tag loss and accepted both
controls. That abstention set is therefore a property of those two defect
shapes under these settings, not sampling noise. DeepSeek resolved all six in
both runs, including the cross-owner case.

Neither provider issued an incorrect verdict in 24 investigations, and neither
produced a false positive on a control. The distinction that matters for a CI
gate is the failure mode: TypeSafe's is silence, DeepSeek's was latency and
cost.

### Cost

The two figures come from different kinds of source and are not equally firm.
TypeSafe's is arithmetic on a rate the provider states in its own usage
dashboard: $0.042 per million input tokens, output not billed. DeepSeek's is
Weave's default-rate estimate for its parsed calls, made by a third party. Both
count only successfully parsed responses, so both undercount a failed request.

On these samples one investigation costs about **$0.00054** with TypeSafe and
about **$0.06** with DeepSeek — a factor of 111 to 119. Extrapolated
sequentially to the 247-test CI run the plan opens with, that is **13 cents and
22–25 minutes against roughly $15 and five to six hours**. The extrapolation
assumes sequential execution and no retries; a real CI job would parallelise and
compress the wall-clock figures, not the cost.

The gap is not token efficiency. Both providers consume a similar volume of
input — 12,950 tokens per investigation against 15,585–16,193 — because they
receive the same evidence through the same engine. Almost all of the difference
is the rate, amplified by DeepSeek's reasoning output being billed while
TypeSafe's output is not. TypeSafe emits 382 output tokens to DeepSeek's ten
thousand, and that advantage does not even reach the invoice.

### What the same loop would cost elsewhere

Two frontier models publish the same rate card, $10 per million input tokens and
$50 per million output. Neither has been run through this loop, so the rows
below are projections rather than measurements, and they are separated in
[cost.ts](../../src/cost.ts) for that reason. Regenerate them with
`npm run cost:project -- <evaluation.json...>`.

Because output tokens carry most of a frontier bill, each unrun model is
projected twice. The verbose column borrows DeepSeek's measured profile of
15,889 input and 10,576 output tokens per investigation. The terse column
borrows TypeSafe's 12,951 and 382. Those brackets are wide on purpose.

| Model | Per investigation | 250 green tests | Basis |
|---|---|---|---|
| TypeSafe `jev-1.13.0` | $0.00054 | **$0.14** | measured |
| DeepSeek-V4-Pro-0813 | $0.0605–0.0649 | **$15–16** | measured, Weave estimate |
| Claude Fable 5.1 | $0.149–0.688 | **$37–172** | projected |
| GPT-6 Astra | $0.149–0.688 | **$37–172** | projected |
| GPT-6 Astra, batch tier | $0.074–0.344 | **$19–86** | projected |

The spread from TypeSafe to a frontier model at the verbose profile is a factor
of roughly 1,270. Even at the terse profile it is 273. Two levers close part of
that gap for anyone who wants frontier reasoning on this workload. Investigating
yesterday's green tests can wait, so batch pricing at half rate applies cleanly,
and the loop resends a stable prefix seven times per investigation, so prompt
caching recovers much of the input half.

The assumption doing the work is that an unrun model reasons at a similar
length. A loop whose answers are enumerated choices gives a model little reason
to write at length, but thinking tokens are billed whether or not they are
returned, so effort settings would decide where inside these brackets a real run
lands. Replacing either projected row with a measured one needs an adapter and
one run of this suite.

This is the H3 question answered for one workflow: at these rates, investigating
every green test in a suite is affordable with the cheaper model and a budget
decision with the larger one. It says nothing about which is affordable for a
suite of defects neither has seen.

Receipts: `.scratch/evaluations/167ffe66-1509-4a8c-9407-45b0e457c896/evaluation.json`
and `.scratch/evaluations/ca68d553-d572-47a1-b162-319e80c99c1a/evaluation.json`.
All twenty-four investigation traces and all four evaluation roots were read
back from Weave as completed.

## Limits

The cases were designed alongside the investigator and contract; they are not
held out. Four related mutations of one workflow are not four independent
regression classes across products. The clean controls cover only two examples,
so zero false positives across four control investigations is reassuring rather
than a measured rate. Repeated model runs on these captures measure variability,
not new application coverage.

Two samples per provider establish that the abstention set is reproducible; they
do not establish its rate, and confidence remains a measure of distribution
concentration rather than calibrated correctness. Regression classes D
(background failure), E (state leakage) and F (missing telemetry) from the plan
are not covered at all by these six captures.

The strongest available fix for the held-out problem is a historical one: a
real fixed bug in an application whose existing E2E test passed anyway, where
the fix commit adds the assertion that was missing. Such a case cannot be
accused of having been written to suit this investigator. That search is the
next piece of work, alongside independent workflows, more clean controls, and
usage accounting for failed responses.

References: [W&B chat completions](https://docs.wandb.ai/inference/api-reference/chat-completions),
[W&B reasoning controls](https://docs.wandb.ai/inference/response-settings/reasoning),
[Weave EvaluationLogger](https://docs.wandb.ai/weave/guides/evaluation/evaluation_logger),
[pinned archive implementation](https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/services/bookmarks.py#L87-L91).
