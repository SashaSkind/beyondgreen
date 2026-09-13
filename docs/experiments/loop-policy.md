# Tuning the loop from its own traces

Executed 2026-09-13 on the unchanged six-case Linkding suite. Three questions,
each answered by measurement rather than argument: where the acceptance
threshold should sit, whether a cheap-first cascade pays, and what the stored
traces can teach without anyone labelling anything.

## The threshold was costing a case for nothing

`npm run sweep -- --suite <suite.json>` re-runs every case at each threshold.
A receipt cannot answer this on its own, because lowering the bar changes which
round the loop stops in, and a run that abstained never produced the Verifier
answer a lower bar would have reached. Re-running is the only honest sweep, and
at $0.00054 an investigation it costs almost nothing.

Forty-two TypeSafe investigations, about $0.023 in total.

| minConfidence | Correct | Abstained | Wrong | False positives |
|---|---|---|---|---|
| 0.30 | 5/6 | 1 | 0 | 0 |
| 0.40 | 5/6 | 1 | 0 | 0 |
| 0.50 | 5/6 | 1 | 0 | 0 |
| 0.60 | 4/6 | 2 | 0 | 0 |
| 0.70 | 4/6 | 2 | 0 | 0 |
| 0.80 (current) | 4/6 | 2 | 0 | 0 |
| 0.90 | 3/6 | 3 | 0 | 0 |

Dropping from 0.80 to 0.50 recovers a case and costs nothing measurable. No
wrong verdict and no false positive appears at any threshold in this range, so
on this suite the default is simply conservative.

Two cautions before anyone moves the number. Six cases tuned and evaluated on
the same six cases is overfitting, and the honest next step is a held-out suite.
And one value gates three separate checks: the Critic's assessment, the
Verifier's verdict, and the Verifier's grounding. Separating them is probably
worth more than moving them together.

## The cascade gets the expensive model's accuracy at a third of the price

`npm run cascade -- --suite <suite.json>` runs TypeSafe first and escalates only
what it refuses to answer.

| Policy | Correct | Cost per 250 tests |
|---|---|---|
| TypeSafe alone | 4/6 | $0.14 |
| Cascade | **6/6** | **$5.36** |
| DeepSeek alone | 6/6 | $15.67 |

The live run matched the replay exactly: 6 of 6, two escalations, two flips, on
`archive_toggles_unread` and `archive_changes_other_owner`. Those are the two
defect shapes TypeSafe declines to conclude on in every study.

The policy choice matters more than it looks. The obvious design escalates a
confident finding for a second opinion, but TypeSafe issued **no wrong verdict
and no false positive across 24 investigations**, so a second opinion on its
findings buys nothing here. Every one of its misses is an abstention. Escalate
what the loop gives up on, not what it concludes.

Escalating findings as well remains available through `--escalateOn
insufficient,regression`, and it is the right setting in production, where there
are no labels and a false alarm is expensive.

## The traces label their own review set

`npm run disagreements` compares providers case by case across the four recorded
studies. It needs no ground truth, which is what makes it usable where labels do
not exist.

Across 18 comparable cases it found 6 disagreements, and **all six were one
provider abstaining. Neither ever contradicted the other.**

That shapes the design. A disagreement where one tier gives up is a gap to fill,
and a cascade fills it automatically. A disagreement where two tiers contradict
each other is a question about what correct means, and it needs a human. On this
benchmark the second kind has not happened yet, and a suite where it does would
be more informative than this one.

Add `--publish` to save the set as the `tier-disagreements` Weave dataset.

## What none of this establishes

Six cases from one workflow, tuned and measured on themselves. A recovered
abstention is not proof the escalation was right, only that it agreed with the
label. The cascade's accuracy is bounded by its most capable tier, and that tier
returned a false positive on the Documenso control described in
[documenso-held-out.md](documenso-held-out.md), so escalation inherits whatever
the expensive model gets wrong.

The threshold, the escalation trigger, and the retrieval order can all be tuned
from measurements like these. The operation contract cannot, and on the evidence
so far it is the binding constraint.
