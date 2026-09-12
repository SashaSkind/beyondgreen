# Beyond Green

> **Your tests passed. We check what they missed.**

## 0. Core Idea

Beyond Green is a **self-correcting CI investigation loop**.

After an E2E test passes, a team of AI agents investigates the evidence generated during the test to find regressions that the test assertions missed.

The agents don't blindly accept their first conclusion. They can:

1. form a hypothesis
2. request additional evidence
3. challenge the hypothesis
4. revise their reasoning
5. verify the final conclusion
6. remember useful investigation patterns for future runs

The core question:

> **"The test passed. Did the system actually behave correctly?"**

---

# 1. Why This Matters

A CI result such as:

```text
247 / 247 E2E tests passed
```

does not prove that everything behaved correctly.

A test may successfully complete its intended flow while:

- an incorrect database state is created
- an unexpected email/event is emitted
- logs contradict the API response
- a background service crashes
- metrics silently disappear
- state leaks into later tests
- a requirement is violated outside the test's assertions

Humans can investigate these problems by looking across logs, databases, network activity, metrics, traces, requirements, and previous runs.

But doing this manually for hundreds or thousands of CI tests is impractical.

**Beyond Green automates that investigation.**

---

# 2. Hackathon Thesis

The project is based on three hypotheses.

### H1 — Green tests can hide real regressions

Demonstrate this using a real open-source application and reproducible regressions.

### H2 — An agent can investigate across heterogeneous evidence

The agent should correlate things such as:

```text
E2E result
   +
application logs
   +
database state
   +
network events
   +
baseline
   +
requirements
```

rather than looking only at the test output.

### H3 — Cheap intelligence makes exhaustive investigation practical

A very capable model may investigate one incident well.

The interesting question is:

> **Can a cheaper/faster model investigate hundreds of green tests economically?**

This is where TypeSafe becomes central.

Measure:

- accuracy
- false positives
- false negatives
- latency
- cost

Do not assume the answer beforehand.

---

# 3. The Agent Loop

This is the most important part of the project.

```text
                E2E TEST PASSES
                       │
                       ▼
                  SCOUT AGENT
                       │
                initial hypothesis
                       │
                       ▼
              INVESTIGATOR AGENT
                       │
                 analyze evidence
                       │
                       ▼
                CRITIC AGENT
                       │
              ┌────────┴────────┐
              │                 │
        insufficient          sufficient
          evidence              evidence
              │                 │
              ▼                 ▼
       EVIDENCE AGENT        VERIFY
              │                 │
        request more            │
          evidence              │
              │                 │
              └───────┐         │
                      ▼         ▼
                   REASON AGAIN
                      │
                      ▼
                  FINAL VERDICT
                      │
                      ▼
               STORE LEARNING
```

The important property is:

> **The agent can recognize that its current evidence is insufficient and decide what to investigate next.**

---

# 4. Agents

The agents can use the same underlying TypeSafe model with different roles.

## Scout

Purpose:

Identify suspicious behavior from the initial evidence.

Input:

- test result
- basic logs
- baseline summary
- test metadata

Output:

```text
Hypothesis:
Something unexpected happened during checkout.
```

---

## Investigator

Purpose:

Develop possible explanations.

Example:

```text
Hypothesis A:
Payment succeeded but an error handler fired.

Hypothesis B:
The email service is reporting a stale failure.

Hypothesis C:
The test environment contains state from a previous run.
```

---

## Evidence Agent

Purpose:

Determine what evidence is needed next.

Example:

```text
Need:
- payment DB record
- email events
- application logs
- previous successful run
```

The agent should call deterministic tools rather than receiving the entire environment every time.

---

## Critic

Purpose:

Try to disprove the current hypothesis.

Example:

> "The email exists, but we haven't established that it is unexpected. Check the requirements and previous successful runs."

This prevents the system from turning every unusual event into a regression.

---

## Verdict Agent

Purpose:

Produce the final evidence-backed conclusion.

Example:

```text
REGRESSION CONFIRMED

Checkout test passed, but the application emitted
a payment-failure email after successfully creating
the payment.

Confidence: High
```

---

# 5. Investigation Memory

Store successful investigations.

Example:

```text
Previous investigation:

Pattern:
API success + missing DB record

Useful evidence:
1. database state
2. application logs
3. previous green run
```

Future investigation:

```text
New test

Similar pattern detected.

→ automatically request DB evidence earlier
```

This gives the system a second form of improvement:

### Within-run improvement

```text
hypothesis
→ critique
→ more evidence
→ revised hypothesis
```

### Across-run improvement

```text
past investigation
→ learned strategy
→ future investigation
→ better evidence selection
```

For the hackathon, **within-run improvement is mandatory**.

Cross-run memory is a stretch goal.

---

# 6. Evidence Layer

The evidence collector is a major part of the system.

Do not simply send raw logs to the model.

Normalize evidence into structured events.

Example:

```json
{
  "timestamp": "2026-09-12T18:42:31.142Z",
  "source": "application_log",
  "service": "checkout",
  "event": "payment_created",
  "metadata": {
    "order_id": "1234"
  }
}
```

Initial evidence sources:

- test result
- application logs
- HTTP/network events
- database state
- previous run
- git diff

Optional:

- metrics
- email
- system logs
- traces

Everything should be correlated onto a common timeline where possible.

---

# 7. Baseline

The simplest version compares the current run to a known-good run.

Example:

```text
KNOWN-GOOD RUN
───────────────
POST /checkout
DB order created
DB payment created
No email
checkout_success = 1


CURRENT RUN
───────────
POST /checkout
DB order created
DB payment created
Email: "Payment failed"
checkout_success = 1
```

The agent sees:

```text
Unexpected event:
payment-failure email

Difference from baseline:
email did not occur in known-good runs
```

Baseline comparison should be deterministic wherever possible.

The AI should focus on **reasoning about the differences**, not rediscovering simple diffs.

---

# 8. Public Benchmark

## Goal

Use a **real open-source product**, not a toy app if possible.

Find a project with:

- real application
- existing E2E tests
- GitHub Actions CI
- backend
- database
- logs
- reproducible local setup
- ideally historical bugs/regressions

Existing application/test code is the dependency.

**All Beyond Green code is built during the hackathon.**

---

## Benchmark Structure

Target:

```text
30–100 E2E runs/tests
5–15 injected regressions
```

Not every test needs a unique bug.

Focus on a small number of strong regression classes.

---

# 9. Regression Classes

## A. Unexpected side effect

```text
Test:
Checkout succeeds

Hidden issue:
Unexpected failure email sent
```

Evidence:

- application logs
- email events
- DB
- baseline

---

## B. Incorrect database state

```text
Test:
API returns success

Hidden issue:
Expected DB record was never created
```

The test does not check the DB.

---

## C. Conflicting sources

```text
API:
workers_available = 2

Logs:
enforcing_capacity = 4

Actual behavior:
4 requests accepted
```

The agent needs to recognize the contradiction.

---

## D. Background failure

```text
E2E:
PASS

System:
background service failed to start
multiple times
```

The user-facing flow still works.

---

## E. State leakage

```text
Test:
PASS

After test:
environment contains unexpected state

Next test:
potentially affected
```

---

## F. Missing telemetry

```text
Application:
"event sent"

Database/metrics:
event never arrived
```

---

# 10. Private Real-World Benchmark

If allowed by the company, use the existing real system privately.

Current benchmark:

```text
20 real test runs
5 known defects
```

Do not expose:

- proprietary tests
- raw logs
- architecture
- requirements
- customer data
- screenshots
- internal identifiers

Use it to validate the approach and report only aggregate metrics if permitted.

Public demo remains fully reproducible.

---

# 11. W&B / Weave

W&B is **not an afterthought**.

Weave should trace the investigation loop.

Example:

```text
Investigation #183

├── Scout
│   ├── hypothesis
│   └── evidence
│
├── Investigator
│   └── hypothesis
│
├── Evidence Agent
│   └── requested DB evidence
│
├── Critic
│   └── rejected hypothesis
│
├── Investigator
│   └── revised hypothesis
│
└── Verdict
    └── confirmed regression
```

Track:

- agent trajectory
- evidence retrieved
- model calls
- latency
- token usage/cost
- final verdict
- evaluation score

Use Weave evaluations to measure:

- detection accuracy
- false positives
- false negatives
- evidence quality
- reasoning quality
- cost/latency

This gives us a strong **Best Use of Weave** story.

---

# 12. TypeSafe Experiment

The key TypeSafe experiment:

```text
Same benchmark
      │
      ├── TypeSafe
      │
      └── larger/stronger model
```

Measure:

| Metric | TypeSafe | Larger model |
|---|---:|---:|
| Regression detection | measured | measured |
| False positives | measured | measured |
| False negatives | measured | measured |
| Latency | measured | measured |
| Cost | measured | measured |

The story is not:

> "TypeSafe is better."

The story is:

> **"Can sufficiently strong machine-native intelligence make exhaustive CI investigation economically viable?"**

---

# 13. Demo

The demo must fit into **3 minutes**.

## 0:00–0:20 — Problem

Show:

```text
CI

247 / 247 tests passed
```

Then:

> "But one of these tests is hiding a regression."

---

## 0:20–1:20 — Investigation

Run Beyond Green.

Show the agent loop:

```text
Scout
 ↓
Hypothesis
 ↓
Critic:
"Not enough evidence."
 ↓
Evidence Agent
 ↓
DB + logs retrieved
 ↓
Investigator
 ↓
Critic
 ↓
Confirmed
```

The important visual is the **loop**, not a dashboard.

---

## 1:20–2:00 — Finding

Show the actual evidence.

Example:

```text
TEST: PASS

18:42:31.188
Checkout completed

18:42:31.201
Payment succeeded

18:42:31.204
Unexpected failure email sent

Previous green runs:
No failure email
```

Then:

```text
REGRESSION CONFIRMED
Confidence: 96%
```

---

## 2:00–2:30 — Second example

Show a harder multi-source contradiction.

```text
API ≠ logs ≠ DB
```

Let the agent explain why this is a regression.

---

## 2:30–3:00 — Sponsor + results

Show Weave.

```text
Investigation trajectory
        ↓
Evaluation
        ↓
TypeSafe vs larger model
        ↓
cost / latency / accuracy
```

Finish with:

> **"247 tests passed. Beyond Green investigated what the tests didn't."**

---

# 14. UI

**No dedicated UI for MVP.**

Use:

- terminal output
- structured Markdown
- Weave UI
- optionally a tiny results page if everything else is finished

Do not spend hackathon time building a dashboard.

The product's novelty is the **investigation loop**, not the frontend.

---

# 15. Architecture

```text
                 GitHub Actions
                       │
                       ▼
                  E2E Tests
                       │
                       ▼
              Evidence Collector
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
      Logs             DB           Network
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                 Evidence Index
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
          Baseline           Requirements
             │                   │
             └─────────┬─────────┘
                       ▼
                    Scout
                       │
                       ▼
                 Investigator
                       │
                       ▼
                    Critic
                       │
                 ┌─────┴─────┐
                 │           │
             More evidence   Enough
                 │           │
                 ▼           ▼
          Evidence Agent   Verify
                 │           │
                 └─────┬─────┘
                       ▼
                  Final Verdict
                       │
                 ┌─────┴─────┐
                 ▼           ▼
              Weave       Memory
```

---

# 16. Implementation Stack

Use the simplest stack possible.

### E2E

Playwright

### Backend

TypeScript / Node.js

### Evidence

JSON + SQLite/Postgres initially

### Model

TypeSafe

### Observability/evaluation

W&B Weave

### CI

GitHub Actions

### Frontend

None initially

---

# 17. Build Order

## Phase 1 — Find the benchmark

**Highest priority.**

Find an open-source application with:

- E2E tests
- CI
- database/backend
- easy local setup

Do not write our own app unless absolutely necessary.

---

## Phase 2 — Baseline

Get:

```text
real application
→ E2E test
→ evidence
→ known-good baseline
```

working.

---

## Phase 3 — One regression

Inject exactly one regression.

Goal:

```text
E2E = PASS

Beyond Green = REGRESSION
```

Do not build multi-agent complexity before this works.

---

## Phase 4 — Investigation loop

Add:

```text
Scout
→ Investigator
→ Critic
→ Evidence Agent
→ Investigator
→ Verdict
```

This is the heart of the hackathon.

---

## Phase 5 — Weave

Instrument every agent step.

Get a complete investigation trajectory visible in Weave.

---

## Phase 6 — More regressions

Add 3–5 strong regression classes.

Prefer difficult failures over lots of trivial ones.

---

## Phase 7 — Evaluation

Create a labeled benchmark:

```text
run
expected:
  clean / regression

actual:
  clean / regression
```

Measure:

- precision
- recall
- false positives
- false negatives
- latency
- cost

---

## Phase 8 — TypeSafe comparison

Run the same benchmark with a stronger model.

Record the results in Weave.

---

## Phase 9 — Demo polish

Only now:

- improve terminal output
- improve evidence formatting
- clean README
- record demo
- prepare 1–2 slides
- rehearse 3-minute presentation

---

# 18. Stretch Goals

Only if the core loop works.

### Investigation memory

Learn evidence-selection strategies from previous investigations.

### More evidence sources

Add:

- metrics
- email
- system journal
- traces

### Parallel investigators

Have multiple investigators independently analyze the same test and have a critic reconcile them.

### Automatic issue generation

Create a GitHub issue from a confirmed regression.

### Production mode

Reuse the same investigation engine for production incidents.

---

# 19. Explicit Non-Goals

Do NOT build:

- AI-generated E2E tests
- browser automation agent
- replacement for Playwright
- generic CI dashboard
- generic LLM judge
- autonomous coding agent
- automatic bug fixing
- full observability platform
- production deployment platform

The project is:

> **A self-correcting post-test investigation loop.**

---

# 20. Hackathon Compliance Checklist

Before submission:

- [ ] Public GitHub repository
- [ ] Project code created during hackathon
- [ ] Existing open-source demo application clearly identified as a dependency
- [ ] W&B/Weave meaningfully integrated
- [ ] TypeSafe used
- [ ] Agent loop is self-correcting
- [ ] Evidence retrieval is autonomous
- [ ] At least one real hidden regression
- [ ] E2E test still passes despite regression
- [ ] Final finding is evidence-backed
- [ ] Investigation trajectory visible in Weave
- [ ] Evaluation benchmark exists
- [ ] Cost/latency measured
- [ ] Sponsor tools documented
- [ ] Public GitHub repo ready for judges
- [ ] <2 minute screen recording
- [ ] 3-minute live demo rehearsed
- [ ] 1–2 slides maximum
- [ ] Team members listed
- [ ] Project description completed
- [ ] Participant surveys completed

---

# 21. Final Product Definition

### One sentence

> **Beyond Green is a self-correcting CI investigation agent that goes beyond E2E pass/fail by autonomously gathering and challenging evidence until it can determine whether a hidden regression actually occurred.**

### Short pitch

> E2E tests tell you whether the assertions passed. Beyond Green investigates whether the system actually behaved correctly. After every green test, a team of agents forms hypotheses, retrieves evidence from logs/DB/network/baselines, critiques its own conclusions, and iterates until it can confirm or dismiss a regression.

### Tagline

> **Your tests passed. We check what they missed.**