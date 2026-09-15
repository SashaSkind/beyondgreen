# Next steps

Updated 2026-09-15. The investigation loop, public presentation, recorded viewer,
and GitHub CI are built. The original hackathon deadline is past; this file tracks
the remaining evaluation and adoption work. Submission and recording status are
not established by the repository.

Read [README.md](README.md) for setup and commands. Read the relevant experiment
report before changing a contract, policy, or published claim. The
[MVP plan](Beyond%20Green%20%E2%80%94%20Hackathon%20MVP%20Plan.md) records the
original scope; it is not a list of features already delivered.

## Current state

- **Investigation and evaluation:** typed TypeSafe and DeepSeek adapters share a
  bounded loop with evidence retrieval, criticism, verification, and explicit
  abstention. A cascade, threshold sweep, and disagreement collection are built.
  [Provider comparison](docs/experiments/linkding-comparison.md) and
  [loop policy](docs/experiments/loop-policy.md) document the measurements.
- **Public demo:** the [presentation](https://sashaskind.github.io/safeci/),
  [recorded viewer](https://sashaskind.github.io/safeci/viewer/index.html), and
  [loop walkthrough](https://sashaskind.github.io/safeci/loop.html) are deployed.
  [DEMO.md](DEMO.md) covers the live demonstration.
- **Reproducible findings:** `npm run report` reads the committed
  [provider receipt projections](docs/experiments/provider-findings/README.md).
  It reproduces `site/findings-data.js` without keys or private files. These ten
  policy runs are a separate sample from the four studies in
  [linkding-comparison-results.json](docs/experiments/linkding-comparison-results.json).
  The viewer's twelve recordings come from the fourth comparison study.
- **Private QA integration:** the historical cleanup replay and the opt-in live
  Playwright wrapper are implemented. Wrapper tests use local fixtures; a live
  farm rollout is a separate operational step. Source logs and identity mappings
  stay in the private repository, outside the public evidence set.
- **Validation:** [CI](.github/workflows/ci.yml) runs the type-check, Node tests,
  and Chromium browser tests on pull requests and pushes to `main`. The
  [latest run](https://github.com/SashaSkind/safeci/actions/workflows/ci.yml)
  records current counts and results. Local capture-validator checks also exist
  at `benchmarks/linkding/test_suite.py`; they are not currently part of CI.

## Invariants

- **Keep scoring metadata outside model state.** Case IDs, expected verdicts,
  mutation patches, local paths, and harness validators belong to evaluation and
  provenance. Public reporting inputs contain labels for offline analysis, not
  for use as investigation evidence.
- **Require the source's declared evidence before a verdict.** Each adapter
  declares `required`; the engine enforces it. Linkding and worker cleanup require
  `database_state` and `operation_contract`. Confidence cannot bypass retrieval.
- **Preserve uncertainty and scope.** `insufficient` is a separate outcome, and a
  verified verdict concerns one observed operation. Provider confidence is not a
  calibrated accuracy measure or directly comparable across providers.
- **Preserve experimental conditions.** Keep upstream tests and assertions
  unchanged when demonstrating an assertion gap. Freeze contracts before a new
  evaluation, retain old results, and identify changed settings. Neither provider
  adapter retries; any new retry policy must be explicit and recorded.
- **Keep billed cost null.** Rates and Weave estimates carry their source;
  missing prices remain unavailable. Parsed-response token totals undercount
  usage when requests fail. Estimated prices are not invoices.
- **Keep private captures private.** Only projected evidence is eligible for
  provider calls or tracing. Raw corporate logs, credentials, and identity
  mappings stay out of commits, public artifacts, and model state.

## Remaining work

1. **Qualify the confidence interpretation before pitching it as provider
   behaviour.** The integration notes compare candidate confidence formulas;
   matching recorded responses is an observation, not a documented API contract.
   Account for nonmatches and distinguish TypeSafe's native statistic from
   DeepSeek's self-reported values. Done when each claim identifies its evidence
   and uncertainty. Any comparison on a common scale needs a new, separately
   labelled evaluation; rescoring old gates does not establish new verdicts.
2. **Sharpen the held-out Documenso contract.** Both providers fail to separate
   the defective and fixed captures. The difference is the false `SENT`/`sentAt`
   claim; neither build dispatches a request in this seeded scenario. Define the
   contract from operation intent, freeze it, then evaluate once and retain both
   outcomes. See [the held-out report](docs/experiments/documenso-held-out.md).
3. **Try the wrapper during a coordinated private QA run.** The farm operator
   selects one supported spec and its designated baseline. Capture immediately
   after cleanup, review the separate investigation receipt, and preserve the
   original test exit code. Done when a fresh run has complete observations,
   local provenance, and a reviewed report. Accumulate more clean and defective
   runs before considering CI blocking.
4. **Extend evaluation provenance and coverage.** Preserve earlier cascade
   tiers' full trajectories and add final input-integrity and trace read-back
   checks before qualifying a completed cascade. Then add independent workflows
   and more clean controls. The current six captures cannot establish broad
   accuracy or a false-positive rate. Candidate selection is in
   [benchmark selection](docs/research/benchmark-selection.md).

Cross-run investigation memory remains a stretch feature from the original plan.
