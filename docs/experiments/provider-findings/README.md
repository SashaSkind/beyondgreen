# Reproduce the provider findings

This directory contains the public inputs for the
[integration notes](https://sashaskind.github.io/safeci/findings.html).
From a fresh checkout, with Node.js 24 or newer:

```sh
npm ci
npm run report
git diff --exit-code -- site/findings-data.js
```

The final command exits successfully when the generated findings match the
committed page data exactly. These commands require no API keys, private
captures, or model calls. `npm test` also checks this reproduction using an
isolated directory containing only the command and its versioned inputs.

To inspect a separate collection of locally recorded runs, use an explicit
directory and output so the published findings remain reproducible:

```sh
npm run report -- --dir .scratch/cascades --out .scratch/findings-data.js
```

## What is included

Ten completed runs of the same six-case Linkding suite: five TypeSafe-only,
two DeepSeek-only, and three cascade runs. Each directory is named after the
original receipt's `cascadeId` and contains a field-by-field projection of its
`cascade.json`:

- Run ID, suite hash, policy, and completion flag.
- Per-case expected outcome, observed verdict, escalation count, and cumulative
  investigation latency.
- The final investigation's reason and ordered role steps, with the exact model
  name, answer choices, confidence values, and probability distributions.
- Recorded summary counts, confusion counts, and mean latency, checked against
  the per-case outcomes and timings when this export was prepared.

The analysis covers **632 answers: 442 TypeSafe and 190 DeepSeek**. An answer is
one typed judgment; a single API request can return more than one answer.
The data reproduces the existing published findings, including abstentions.
Repeated investigations of these six captures do not add independent test cases.

Only `final.steps` contributes to answer statistics. The original cascade
receipts retain earlier tiers' totals but omit their full steps. Consequently,
this is a sample of final-tier answers, not every answer produced by every tier.
Per-case cumulative latency includes all attempted tiers. None of these figures
measures browser capture time, Weave setup, or end-to-end CI duration.

## Provenance and projection

[manifest.json](manifest.json) records a SHA-256 for each public receipt and a
separate SHA-256 for its original local receipt. The generator verifies public
receipt checksums before writing its output. The original hashes identify the
source files for someone who has them; the public export is sufficient to
recompute the report without those files.

The projection copies the listed fields without changing numeric values or
answer order. It excludes repeated prompt state, questions, database captures,
local paths, and unrelated metadata. No private STT/QA capture is included.
Case names and expected outcomes are scoring metadata for this offline report;
they are not supplied to an investigation model.

The export establishes reproducibility of the analysis over recorded answers.
It does not rerun the models or reproduce application state. For those workflows,
see the [provider comparison](../linkding-comparison.md) and
[Linkding capture instructions](../../../benchmarks/linkding/README.md).
