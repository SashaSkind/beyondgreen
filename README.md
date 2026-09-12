# Beyond Green

Your tests passed. We check what they missed.

A post-test investigation loop that gathers and challenges evidence to detect
regressions missed by passing E2E assertions. See the
[MVP plan](Beyond%20Green%20%E2%80%94%20Hackathon%20MVP%20Plan.md).

The [benchmark selection](docs/research/benchmark-selection.md) starts with
Linkding, then Vendure. Source reviews identify candidate assertion gaps.
The [Linkding clean baseline](benchmarks/linkding/README.md) now passes with
captured browser, HTTP, and database evidence. The
[archive-to-delete experiment](benchmarks/linkding/README.md#archive-to-delete-experiment)
also proves the same test stays green while the bookmark is deleted.

## W&B Weave connection

Requires Node.js 24 or newer.

1. Run `npm ci`.
2. Copy `.env.example` to `.env`.
3. Create a personal API key in [W&B User Settings](https://wandb.ai/settings)
   and set `WANDB_API_KEY` in `.env`.
4. Set `WEAVE_PROJECT` to `your-team/beyond-green`, or `beyond-green` for your
   default team. Weave creates the project if it does not exist.
5. Run `npm run weave:check`.

The check uploads one synthetic connection trace, reads it back, and prints its
URL. It makes no model calls and uploads no application evidence. `.env` is
ignored by Git; keep API keys there or in your environment.

Run `npm run check` to type-check the project and `npm test` for local tests.

Reference: [Weave quickstart](https://docs.wandb.ai/weave/quickstart).

## Model connections

Set `TYPESAFE_API_KEY` in `.env`. The investigator defaults to `jev-1.13.0`;
set `TYPESAFE_MODEL` to override it. The standalone connection probe defaults
to `jev-latest` when that environment variable is absent.

The comparison model defaults to `deepseek-ai/DeepSeek-V4-Pro-0813` through
W&B Inference, using the existing `WANDB_API_KEY`. Set
`WANDB_INFERENCE_PROJECT` to the full `team/project` with inference access.
`WANDB_INFERENCE_MODEL` can override the model ID.

Run `npm run models:check` to send one small synthetic evidence question to each
provider. This makes billable model calls. The command validates the answers,
reports token usage and request latency, and saves a receipt in the ignored
`.scratch/model-connectivity.json`. This is a connection check, not an accuracy
or performance benchmark, and it does not send traces to Weave.

References: [TypeSafe HTTP API](https://docs.typesafe.ai/api.md),
[W&B chat completions](https://docs.wandb.ai/inference/api-reference/chat-completions).

## Investigate a passing Linkding test

After capturing the clean/mutant pair, pass their printed artifact directories:

```sh
npm run investigate -- --run <current-run-directory> --baseline <clean-run-directory>
# Use the same investigation loop with the comparison model:
npm run investigate -- --run <current-run-directory> --baseline <clean-run-directory> --provider deepseek
```

This makes billable calls to the selected provider and sends normalized synthetic test evidence
and role trajectories to your Weave project. A Scout proposes a typed
hypothesis; a Critic chooses missing evidence; the Investigator revises its
hypothesis; a separate Verifier checks the final conclusion. The model chooses
retrievals from database state, a pinned archive contract, and a validated
known-good run. Both database state and contract are required before a verdict.

The command prints each decision and writes a complete JSON receipt under
`.scratch/investigations/<id>/`. It verifies the parent trace and child steps
by reading them back from Weave. Exit status is 0 for a completed `clean` or
`regression` investigation, 2 for `insufficient`, and 1 for setup/trace failures;
this is an investigator, not yet a CI gating command.

Experiment labels, patches, local artifact paths, and `run.json` validation
results never enter model state. Missing evidence, exhausted rounds, service
errors, low confidence, or verifier disagreement produce `insufficient`.
The provisional confidence threshold is 0.8; model confidence is not calibrated
correctness. Receipts retain raw probabilities, tokens, and latency. Dollar
cost remains unavailable rather than being reported as zero.

The first live pair produced **clean** for the baseline and **regression** for
the deletion, with both browser tests still passing. See the
[recorded investigation](docs/experiments/linkding-typesafe.md) for evidence,
Weave links, and limitations.

## Compare TypeSafe and DeepSeek

```sh
npm run benchmark:linkding:suite
npm run evaluate -- --suite <printed-suite.json-path>
```

The six-case suite contains two clean controls and four archive defects. All six
run the unchanged upstream browser test. Three defects preserve the bookmark
count while corrupting a field, losing an association, or changing another
owner's state. Ground truth comes from exact state validators in the capture
harness. The evaluator checks artifact hashes before and after each investigation;
case names and expected verdicts are used for scoring, never sent to the models.

Both providers use the same engine, evidence catalog, contract, questions, four
critic-round limit, and provisional 0.8 acceptance threshold. Each chooses its
own retrieval trajectory. DeepSeek runs with reasoning enabled, an 8,192-token
response budget, and a 90-second request timeout; TypeSafe has a 30-second
request timeout. Neither adapter retries. DeepSeek's generated confidence and
probabilities are self-reported, unlike TypeSafe's native distributions, so the
identical threshold does not establish equivalent calibration.

`--repeats 1-10` repeats model investigations on the same captured evidence;
it does not create new browser samples. `--provider typesafe` or `--provider deepseek`
runs only that provider. By default, both run once per case with alternating
provider order. Receipts under `.scratch/evaluations/<id>/evaluation.json` retain
every result, code and artifact fingerprints, model configuration, and trace URL.
Interrupted or unverifiable evaluations remain marked incomplete. Completed
evaluations may contain wrong or insufficient verdicts and still exit 0.

Weave stores a versioned dataset, separate provider evaluations, per-case
correctness/abstention scores, and linked full investigation traces. Summary
accuracy includes abstentions in its denominator; confusion counts distinguish
wrong verdicts from abstentions. Token totals include only successfully parsed
responses and therefore undercount billing when requests fail. Comparable billed
cost remains unavailable; the report includes partial Weave estimates for DeepSeek.
See the [first comparison](docs/experiments/linkding-comparison.md)
for measured results and the response-budget limitation it exposed.
