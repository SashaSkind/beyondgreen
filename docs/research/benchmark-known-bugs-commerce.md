# Known-bug candidates: commerce and transactional systems

Researched 2026-09-12 against primary GitHub sources (issue/PR text, commit
diffs, and file state at pinned revisions) using the `gh` CLI and blobless
clones outside the project tree. **Nothing here was installed, built or
executed.** Every finding below is a **source-backed candidate**: the citations
are verifiable, the conclusions about what a test asserted are read off the
diff, but no baseline run and no mutant run has been performed. Where a claim
depends on runtime behaviour it is marked as unverified in the final section.

Domain scope: commerce and transactional systems — Vendure (already pinned as
the second benchmark), Medusa, Saleor, Spree, Sylius, Bagisto. Linkding is
already in use and is out of scope here.

Provenance: the Vendure, Medusa, Spree and Sylius work was done directly. The
Saleor and Bagisto findings came from a parallel source review in this same
session; their load-bearing claims were re-verified here against the GitHub
commit API, and §7 records exactly which claims were and were not re-checked.

Regression classes refer to section 9 of *Beyond Green — Hackathon MVP Plan*:
**A** unexpected side effect, **B** incorrect database state, **C** conflicting
sources, **D** background failure, **E** state leakage, **F** missing telemetry.

---

## 1. Shortlist

| App | Pinned revision | Stack | E2E framework | Database | Best historical gap | Class | Setup cost | Main risk |
|---|---|---|---|---|---|---|---|---|
| **Vendure** (keep) | `a9559073e223794f984cc00fed94d04dd50a47cc` | TypeScript / NestJS / TypeORM + React dashboard | Playwright (`packages/dashboard/e2e`); separate API suite `packages/core/e2e` (vitest) | sql.js in-memory for both suites; MySQL/MariaDB/Postgres in other CI jobs | Cancelling a fulfilment restored `stockOnHand` but never `stockAllocated`; the *same* e2e test stayed green across three shipped releases (#1198 → #1250 → #2306) | B + C + E | Moderate: monorepo build (bun 1.3.10, Node 22) + Chromium; no DB/Redis service | Monorepo build weight; browser suite asserts almost nothing, but the parallel `core/e2e` API job asserts stock heavily, so injections must be scoped to the `dashboard-e2e` job. **The seeded variant used by every order-lifecycle browser test has `trackInventory=false`** (see 2.5) |
| **Medusa** | `f8dce55556a1e68d6ea9b2fb88852b2a76fbd73c` | TypeScript, workflow engine, MikroORM | Jest HTTP integration (`integration-tests/http`, 166 spec files) — **no browser suite** | Postgres + Redis (required) | Inventory reservations created on draft-order edit instead of on conversion to a real order (#14010); credit lines miscounting refunds on cancellation (#14781, #15153) | B + C | Higher: Postgres + Redis + yarn monorepo build | No browser/Playwright suite anywhere at HEAD, so it violates the "existing E2E browser test" preference |
| **Saleor core** | `6e2dc35d0cbc7de85ce3503d5e872e2f672ba70e` | Python / Django | pytest `saleor/tests/e2e` (in-process GraphQL, **not a browser**) — a real PR gate with no secrets | Postgres 15 only for the e2e marker | An e2e test asserted the defect: one order carrying both a new-API `Transaction` and an old-API `Payment` charge (#18069); order status asserted from the mutation response and never re-read from the DB (#18103) | B + C | Low: one Postgres container + `uv sync`; comfortably under 30 min | Not a browser suite; per-test transaction rollback must be defeated to snapshot the DB |
| **Saleor dashboard** | `66d28330ed0ad22a4c307049e69ed9c49ffc85cf` | React | Playwright | — | none usable | — | n/a | **Exclude.** Not in the PR gate; needs 6 secrets and a pooled Saleor Cloud instance; specs address hardcoded cloud-seeded IDs |
| **Bagisto** | `d259fcd5681087fbee236ae62870da849a365fe7` (branch `2.4`) | PHP / Laravel + Vue | Playwright (76 shop + 61 admin specs) **and** 125 Pest HTTP feature tests | MySQL 8.0 / MariaDB 10.11 | A one-line inventory over-restock fix with no test, whose pre-existing cancel-order test asserts a DB row against its own freshly-read values (#10205); coupon double-spend under concurrent checkout (#11202) | B | 20–35 min (Pest-only ~15–20) | PHP toolchain; browser suite is **label-gated** on PRs (`Need Playwright Testing`) |
| **Spree** | `ad37c5af946dc8afbbb62c8ed57d204850f811e7` | Ruby on Rails | RSpec model/controller/API-integration specs — **zero feature or system specs in the pinned tree** | Postgres/MySQL | n/a | — | n/a | **Reject.** No browser suite exists at HEAD, so the "coverage that passed anyway" criterion cannot be met; plus a Ruby runtime |
| **Sylius** | `27ff385b5a5723b24be5e763ebdfe8cfd07d2fe4` | PHP / Symfony | Behat — **855 `.feature` files**, per-database e2e CI workflows | MySQL / MariaDB / PostgreSQL | not pursued | — | Highest of the six | **Reject on cost.** PHP + Symfony + Selenium/Panther + a second requirements language (Gherkin). Best future candidate if a specification-rich benchmark is ever wanted |

**Verdict up front: Vendure remains the right second benchmark.** Nothing in
this domain beats it, and this pass found the strongest historical evidence in
the whole review inside Vendure itself. But one concrete correction to
`benchmark-commerce.md` is required before the first mutation is attempted —
see §2.5.

---

## 2. Vendure (primary recommendation)

Pin: [`a9559073e223794f984cc00fed94d04dd50a47cc`](https://github.com/vendurehq/vendure/commit/a9559073e223794f984cc00fed94d04dd50a47cc)
(default-branch head, committed 2026-09-11T18:52:49Z). Same pin as
[`benchmark-commerce.md`](benchmark-commerce.md) and
[`benchmark-selection.md`](benchmark-selection.md).

Two distinct suites, run by two distinct CI jobs in
[`.github/workflows/build_and_test.yml`](https://github.com/vendurehq/vendure/blob/a9559073e223794f984cc00fed94d04dd50a47cc/.github/workflows/build_and_test.yml):

- `dashboard-e2e` — job name `dashboard e2e (${{ matrix.shard }})`, 4 shards,
  `bun run e2e:pw` in `packages/dashboard`. Real browser suite.
- `e2e-sqljs`, `e2e-mariadb`, `e2e-mysql`, `e2e-postgres` — job names
  `e2e (sqljs)` etc., `bun run e2e`. The long-lived API-level suite in
  `packages/core/e2e`.

This split matters for every mutation decision below and is stated explicitly
in §2.6.

### 2.1 Strongest finding — fulfilment cancellation restored only half of the stock invariant, three times

This is the best-evidenced assertion gap found anywhere in this review. The
same feature, with the same e2e test file, shipped broken in **three separate
releases**, and each fix tells us something different about the gap.

**Occurrence 1 — v1.3.1.**
Issue [#1198 "Allocated stock should be reverted when cancelling a
fullfillment"](https://github.com/vendurehq/vendure/issues/1198) (opened
2021-10-27, reported against `@vendure/core` 1.3.1, Postgres 11). Reproduction
is a plain admin flow: make an order, fulfil it through the Admin UI, cancel
that fulfilment.

Fix commit
[`00ac70dd63baa8432376200dc5afba606f7a16fd`](https://github.com/vendurehq/vendure/commit/00ac70dd63baa8432376200dc5afba606f7a16fd)
("fix(core): Correctly cancel sales when cancelling Fulfillment", 2021-11-08)
changed `packages/core/src/service/helpers/fulfillment-state-machine/fulfillment-state-machine.ts`
and **added** the test
`it('creates Cancellations & adjusts stock when cancelling a Fulfillment')`
to `packages/core/e2e/stock-control.e2e-spec.ts` (inside `describe('sales')`).
That new test asserted `stockOnHand` only.

**Occurrence 2 — v1.3.4. This is the held-out gap.**
Issue [#1250 "Allocated stock should be reverted when cancelling a fullfillment
— Part 2"](https://github.com/vendurehq/vendure/issues/1250) (opened
2021-11-30, reported against 1.3.4). The reporter says it explicitly: *"I've
reported a similar issue (#1198) but the fix was only for `stockOnHand` not for
the `stockAllocated` value."*

- **Pre-existing test that passed anyway:**
  `packages/core/e2e/stock-control.e2e-spec.ts`,
  `describe('Stock control') › describe('sales') ›
  it('creates Cancellations & adjusts stock when cancelling a Fulfillment')`
  (line 432 at the fix's parent commit).
- **It was running in CI:** at that revision
  `.github/workflows/build_and_test.yml` contains a job named `e2e tests`
  running `yarn e2e`. So the suite covering this exact feature was green while
  the defect was in two tagged releases.
- **Assertion that was absent:** `stockAllocated` on the tracked variant after
  `transitionFulfillmentToState(..., 'Cancelled')`. The test read the variant
  back three times and asserted only `stockOnHand` (5 → 4 → 5).
- **Worse:** the test *did* assert the full `stockMovements` array — and that
  array encoded the buggy behaviour. It listed the `CANCELLATION` movement and
  no `ALLOCATION` movement, so the test actively certified the missing side
  effect.

Fix commit
[`693fd839af42b6162241fbcab8e07e651d6e8751`](https://github.com/vendurehq/vendure/commit/693fd839af42b6162241fbcab8e07e651d6e8751)
("fix(core): Re-allocate stock when cancelling a Fulfillment", 2021-12-02)
changed `fulfillment-state-machine.ts`, `order.service.ts` and
`stock-movement.service.ts`, and its **only** test change was to add the
missing assertions to that same pre-existing test:

```
+            expect(trackedVariant2.stockAllocated).toBe(1);
+            expect(trackedVariant3.stockAllocated).toBe(0);
+            expect(trackedVariant4.stockAllocated).toBe(1);
                 { id: 'T_23', quantity: 1, type: 'CANCELLATION' },
+                { id: 'T_24', quantity: 1, type: 'ALLOCATION' },
```

plus a trailing `cancelOrder` step asserting
`expect(trackedVariant5.stockAllocated).toBe(0)`.

This satisfies the strongest evidence tier: the fix commit strengthened an
assertion on a feature whose test already existed and passed.

**Occurrence 3 — v2.0.3, and this time no test at all.**
Issue [#2306 "Unable to cancel fulfillment"](https://github.com/vendurehq/vendure/issues/2306)
(opened 2023-07-21 against 2.0.3, Postgres; label `type: bug 🐛`). Fix commit
[`f6881bf3077fd855014d02aa0a387d23df71cc25`](https://github.com/vendurehq/vendure/commit/f6881bf3077fd855014d02aa0a387d23df71cc25)
("fix(core): Fix incorrect allocation logic in default fulfillment process",
2023-07-27) is a one-hunk change in
`packages/core/src/config/fulfillment/default-fulfillment-process.ts`:

```
-            const orderLineInput = fulfillment.lines.map(l => ({ orderLineId: l.id, quantity: l.quantity }));
+            const orderLineInput = fulfillment.lines.map(l => ({
+                orderLineId: l.orderLineId,
+                quantity: l.quantity,
+            }));
```

A **fulfilment-line** id was being passed where an **order-line** id was
required, so the cancellation and re-allocation stock movements were written
against the wrong order line. The commit adds **no test**. And at its parent
commit the test `creates Cancellations & adjusts stock when cancelling a
Fulfillment` existed (line 480 of `stock-control.e2e-spec.ts`) and by then
asserted *both* `stockOnHand` and `stockAllocated`. So a test that directly
exercises fulfilment cancellation and checks both stock fields was green while
users could not cancel a fulfilment at all.

Regression class mapping: **B** (persisted stock levels and stock-movement rows
wrong) primarily; **C** (the movement ledger and the stock level disagree); **E**
(saleable stock is `stockOnHand − stockAllocated`, so a leaked allocation
silently shrinks availability for every later test against the shared seeded
database).

### 2.2 Second finding — refund reported success while the gateway was asked for 0

A three-occurrence family about the amount handed to the payment gateway.

**Occurrence 1.** Issue
[#2302 "[V2.0.4] Refund always send `amount===0` to payment method
`createRefund` function"](https://github.com/vendurehq/vendure/issues/2302)
(2023-07-20, label `type: bug 🐛`). Fix commit
[`2b49edfba4b62b89f990a1c343da64d7c199eabf`](https://github.com/vendurehq/vendure/commit/2b49edfba4b62b89f990a1c343da64d7c199eabf)
("fix(core): Fix createRefund amount on cancelled OrderLines", 2023-07-25):

```
-            if (orderLine && 0 < orderLine.quantity) {
+            if (orderLine && 0 < orderLine.orderPlacedQuantity) {
```

- **Pre-existing test that passed anyway:**
  `packages/core/e2e/order.e2e-spec.ts`, `describe('refunds') ›
  it('can add another refund if the first one fails')` (line 1838 at the
  parent). It asserted `expect(refund2.state).toBe('Settled')` and
  `expect(refund2.total).toBe(order.totalWithTax)`.
- **Assertion that was absent:** the `amount` argument actually handed to
  `PaymentMethodHandler.createRefund`. The `Refund` row looked right; the money
  instruction sent outward was zero.
- **The evidence was not even being captured.** The fix had to extend the test
  fixture before the value could be asserted at all —
  `packages/core/e2e/fixtures/test-payment-methods.ts`,
  `singleStageRefundablePaymentMethod`, gained `metadata: { amount }` in its
  `createRefund` return. Only then could the new test assert
  `expect(refundOrder.metadata.amount).toBe(order.totalWithTax)`.

That last point is the cleanest statement of the Beyond Green thesis found in
this review: the test suite could not have caught this defect even in
principle, because the relevant value was never recorded anywhere the test
could see it. An investigation agent reading application logs and the payment
handler's own record is looking in the one place that knows.

**Occurrence 2.** Issue
[#2523 "Refund always send `amount===0` to payment method `createRefund`
function"](https://github.com/vendurehq/vendure/issues/2523) (2023-11-13,
against 2.1.1) — the same defect via a different path. Fix commit
[`b5a265f93dcb65ddf30b2d3f62beb961f667d539`](https://github.com/vendurehq/vendure/commit/b5a265f93dcb65ddf30b2d3f62beb961f667d539)
("fix(core): Send the correct amount to `refundOrder` (#2559)", 2023-12-04)
changed `packages/core/src/config/order/default-order-process.ts` and added
**no test**; in [PR #2559](https://github.com/vendurehq/vendure/pull/2559) the
checklist item "I have added or updated test cases" is left unchecked. The PR
body explains the mechanism precisely: `orderPlacedQuantity` was written by a
per-line `update()` and then overwritten back to 0 when the Order entity was
persisted afterwards.

**Occurrence 3.** Commit
[`b6a569139d8ada6306d9e6f1dd42224ac180701f`](https://github.com/vendurehq/vendure/commit/b6a569139d8ada6306d9e6f1dd42224ac180701f)
("fix(core): Fix amount being sent to payment handler refund method",
2024-03-14) — one token, `total` → `constrainedTotal`, in
`payment.service.ts`; no test. With multiple payments on one order the gateway
was asked to refund more than that payment held while the `Refund` row stayed
correct. Pure class **C**.

Regression class mapping: **C** primarily (DB `Refund.total` vs the amount sent
to the gateway), with **A**/**F** flavour (the external side effect is wrong or
absent while every local signal says success).

**Reachability caveat at the pin.** The historical mutation is *not* reachable
through today's dashboard refund flow:
[`use-refund-order.ts`](https://github.com/vendurehq/vendure/blob/a9559073e223794f984cc00fed94d04dd50a47cc/packages/dashboard/src/app/routes/_authenticated/_orders/hooks/use-refund-order.ts)
sends an explicit `amount: payment.amountToRefund`, and
`PaymentService.getRefundAmount` short-circuits on `input.amount`, bypassing the
deprecated `orderPlacedQuantity` arithmetic entirely. Also, the dashboard e2e
server is configured with `dummyPaymentHandler`
([`e2e-shared-config.ts`](https://github.com/vendurehq/vendure/blob/a9559073e223794f984cc00fed94d04dd50a47cc/packages/dashboard/e2e/fixtures/e2e-shared-config.ts),
`export const e2ePaymentMethodHandlers = [dummyPaymentHandler]`), which defines
no `createRefund`; `PaymentMethodHandler.createRefund` therefore returns `false`
and no gateway amount exists to contradict. The usable observable in a browser
run is the persisted `refund` row and its `refund_line` rows, not a handler
argument.

### 2.3 Third finding — order state committed without its side effects

Issue [#4686 "OrderService.transitionToState leaves order in corrupted
half-committed state if onTransitionEnd throws"](https://github.com/vendurehq/vendure/issues/4686)
(2026-04-30). The issue body is unusually good evidence for this project: it
lists exactly the divergence an investigator would have to find.

> `order.state` = the new state (saved by save 1) … `order.active` = `true` …
> `order.orderPlacedAt` = `null` … No `ORDER_STATE_TRANSITION` history entry
> recorded

and gives a real production history trace ending in "(no further history
entries)". Fix commit
[`0153518e75e0b9969b2c7ba5e13a9f4a8f4f2004`](https://github.com/vendurehq/vendure/commit/0153518e75e0b9969b2c7ba5e13a9f4a8f4f2004)
("fix(core): Make state-machine transitions atomic on hook failure (#4689)",
2026-04-30) wrapped the transitions in `withTransaction` across
`order.service.ts`, `payment.service.ts`, `fulfillment.service.ts` and
`stock-movement.service.ts`, and added
`describe('onTransitionEnd rollback (#4686)')` to the **pre-existing**
`packages/core/e2e/order-process.e2e-spec.ts`.

Honest weakness: this is closer to a *coverage* gap than an assertion gap. The
defect only manifests when `transitionToState` is called without an outer
`@Transaction()` — a worker job, scheduled task, plugin mutation or event-bus
subscriber — so the existing API tests never drove the failing path. Cite it as
a class **B** exemplar and as a source-backed requirement ("a state transition
must not commit without its `onTransitionEnd` side effects"), not as proof that
a green test hid it.

Class: **B**, with **F** (the missing `ORDER_STATE_TRANSITION` history entry).

### 2.4 Fourth finding — money silently detached from an order, with no error, event or log

Commit
[`b7983fe53ef64f430399afbb4dc20a79daaaae81`](https://github.com/vendurehq/vendure/commit/b7983fe53ef64f430399afbb4dc20a79daaaae81)
("fix(core): disable orphan-nullification of surcharges on Order save",
2026-09-09). `Surcharge.order` used TypeORM's default
`orphanedRowAction: 'nullify'`, so saving an Order set `orderId` to `NULL` on
every persisted `Surcharge` row missing from that Order's in-memory
`surcharges` array. The commit message states the symptom in Beyond Green's own
terms: *"a Surcharge added since — by a blocking event handler, or by a
concurrent request — was silently detached: no error, no event, no log."*

The fix added `it('does not detach Surcharges when saving an Order with a stale
surcharges array')` to the pre-existing
`packages/core/e2e/order.e2e-spec.ts` (present at the pin, line 2464). A
surcharge is a money line, so this is a textbook class **A**/**B** with **F**:
the only way to see it is to compare the order total against the surcharge
rows.

Caveat on provenance: this commit carries an AI co-author trailer, so it does
not carry the same "real user, real release" weight as #1198/#1250/#2302. Use
it as a class exemplar, not as headline historical evidence.

### 2.5 Correction required to `benchmark-commerce.md`: the target variant does not track inventory

`benchmark-commerce.md` proposes, as the first Vendure regression, omitting
`updateStockOnHandForLocation` in `StockMovementService.createSalesForOrder`,
and correctly flags "Confirm that the selected seeded variant tracks inventory
before accepting this mutation." **Source inspection says it does not.**

- Every order-lifecycle browser test builds its order through the helper
  `createNewOrder` in
  [`packages/dashboard/e2e/tests/sales/orders.spec.ts`](https://github.com/vendurehq/vendure/blob/a9559073e223794f984cc00fed94d04dd50a47cc/packages/dashboard/e2e/tests/sales/orders.spec.ts),
  which picks its line item with
  `productVariants(options: { take: 1 })` — the first variant, whatever it is.
- The dashboard e2e server seeds products from
  [`packages/core/e2e/fixtures/e2e-products-full.csv`](https://github.com/vendurehq/vendure/blob/a9559073e223794f984cc00fed94d04dd50a47cc/packages/core/e2e/fixtures/e2e-products-full.csv)
  (set in
  [`global-setup.ts`](https://github.com/vendurehq/vendure/blob/a9559073e223794f984cc00fed94d04dd50a47cc/packages/dashboard/e2e/global-setup.ts)
  as `productsCsvPath`). That CSV has a `trackInventory` column. Of its 34
  variant rows, **33 are `false`**; exactly **one** is `true`: the Laptop
  variant `13 inch|16GB`, SKU `L2201316`, `stockOnHand` 100. The first row —
  SKU `L2201308`, `13 inch|8GB` — is `false`.
- The import parser maps an explicit `false` to `GlobalFlag.FALSE`
  (`packages/core/src/data-import/providers/import-parser/import-parser.ts`),
  and `StockMovementService.trackInventoryForVariant` returns true only for
  `GlobalFlag.TRUE` or `GlobalFlag.INHERIT` with the global flag on. An
  explicit `FALSE` therefore wins over the `Channel.trackInventory` and
  `GlobalSettings.trackInventory` column defaults (both `default: true`).

Consequence: for the variant the browser tests actually use, both stock-level
updates inside `createSalesForOrder` are already skipped, so deleting one of
them changes nothing observable. The proposed mutation would very likely
produce a *false negative benchmark case* — a "regression" with no evidence
behind it.

Three ways out, in order of preference, none executed:

1. **Choose a side effect that is not gated by `trackInventoryForVariant`.** In
   `createSalesForOrder` the `Sale` rows themselves and the `getSaleLocations`
   call are unconditional; only the two
   `stockLevelService.update…ForLocation` calls sit inside the
   `trackInventoryForVariant` guard. The `ORDER_FULFILLMENT_TRANSITION` history
   entry and the `StockMovementEvent` publish are likewise unconditional. A
   missing `Sale` row is persisted-state evidence even for an untracked
   variant — and `packages/core/e2e/stock-control.e2e-spec.ts` has
   `creates a Sale on Fulfillment creation`, so that mutation is caught by the
   API job but not by the browser job (see §2.6).
   **The one mutation site found to be invisible to every upstream test** is the
   `StockMovementEvent` publish: a scan of all 628 test/spec/e2e `.ts` files in
   the monorepo at the pin found **zero** references to `StockMovementEvent`.
   Suppressing that publish while leaving the `Sale` rows intact is a clean
   class **F** case (the application records the movement; nothing downstream is
   ever told). It requires the harness to subscribe to the Vendure event bus as
   an evidence source, and the requirement it violates is weaker than a money or
   stock invariant — nothing user-visible breaks — so treat it as the
   "cross-suite-invisible" option rather than the headline case.
2. **Fix the fixture, not the test.** Flip SKU `L2201308` to
   `trackInventory: INHERIT`/`TRUE` through the Admin API in the harness's
   environment setup — outside the upstream spec file, and applied identically
   to baseline and mutant runs. Then the stock mutation in
   `benchmark-commerce.md` becomes live and the historical requirement from
   §2.1 applies directly.
3. **Drive the tracked variant.** Only SKU `L2201316` tracks inventory; any
   scenario that must exercise real stock arithmetic has to reach it, which
   means changing the upstream test — against the stated preference.

### 2.6 What the browser tests actually assert, and the suite-scoping decision

At the pin, `packages/dashboard/e2e/tests/sales/orders.spec.ts` contains
`test.describe('Order lifecycle')` with, among others:

- `should fulfill an order` (line 632) — opens the dialog, checks the heading
  and that a `fulfill-quantity` input is visible, submits, then asserts one
  toast matching `hasNotText: /error/i` is visible. No assertion on stock
  levels, stock movements, fulfillment state or order state.
- `should process a refund` (line 833) — fills a refund quantity, picks a
  reason and a payment, submits, then the same single non-error-toast
  assertion. No assertion on `Refund.total`, refund state, payment balance or
  order state.
- `should transition order state` (line 663) and `should transition order state
  after adding payment` (line 706) — same shape.

There is **no browser test that cancels a fulfilment** at the pin, so the §2.1
feature has *zero* browser coverage today: a strictly wider gap than the
historical one.

**Scoping decision that must be made explicit in the benchmark.** Any stock
mutation that survives the browser suite will still be caught by
`packages/core/e2e/stock-control.e2e-spec.ts`, which contains 118
`stockOnHand`/`stockAllocated` assertions at the pin, including
`updates stockOnHand and stockAllocated when Sales are created` and
`creates a Sale on Fulfillment creation`. That file runs in the separate
`e2e-sqljs` / `e2e-mariadb` / `e2e-mysql` / `e2e-postgres` jobs, not in
`dashboard-e2e`. So the benchmark must declare its gate as the `dashboard-e2e`
job and report "the browser suite is green", never "the upstream suite is
green". That is defensible — it mirrors teams whose browser suite is the
release gate — but it must be written down, and the report should note that the
API suite would catch the same mutation, which is itself good evidence that the
invariant is real and machine-checkable.

If a stronger claim is wanted for one case — green across *both* suites — the
only mutation site found to be unasserted by any upstream test is the
`StockMovementEvent` publish (§2.5, option 1): zero references across all 628
test/spec/e2e `.ts` files in the monorepo at the pin. Use it for at most one
benchmark case; its requirement is thinner than the stock and money invariants,
and it needs an event-bus subscriber in the evidence collector.

### 2.7 Supplementary Vendure findings (same evidence pattern, lower priority)

- **Coupon usage limit bypassed under concurrency.** Commit
  [`b27636420f118502a8c6f740af135c88fb2e737d`](https://github.com/vendurehq/vendure/commit/b27636420f118502a8c6f740af135c88fb2e737d)
  ("fix(core): Prevent coupon usage limit bypass via concurrent checkout race
  condition (#4660)", 2026-04-29). At the parent commit
  `packages/core/e2e/order-promotion.e2e-spec.ts` already contained
  `describe('usage limit')` and `describe('per-customer usage limit')` with
  `it('returns error result when usage exceeds limit')` in each, plus
  `describe('usage limit for auto-applied promotions (no coupon code)')`. All
  passed; the absent assertion was the promotion's persisted usage count after
  *concurrent* checkouts. The fix changed `order.service.ts` and
  `promotion.service.ts` and added `describe('concurrent usage (race
  condition)')` to that same pre-existing file. Class **B** with **E**.
- **Browser-level proof that the Playwright suite under-asserts.** Issue
  [#4728 "Refund UI does not reflect quantity/items changed during order
  modification"](https://github.com/vendurehq/vendure/issues/4728), fixed by
  [`e7f8fe0029ceba9b450f60554226cec2cf628309`](https://github.com/vendurehq/vendure/commit/e7f8fe0029ceba9b450f60554226cec2cf628309)
  ("fix(dashboard): Reflect modified line quantities in refund dialog (#4917)",
  2026-07-06). At its parent, the browser tests `should open refund dialog and
  show order lines` and `should process a refund` already existed and passed
  while the dialog capped the refundable quantity at `orderPlacedQuantity`,
  under-refunding a modified line. The fix added a new browser test asserting
  the input's `max` attribute. The symptom is UI-visible (so a weaker class
  fit), but it is direct evidence that this suite's assertions are thin.
- **Suite age.** The dashboard Playwright suite was introduced only in
  [`1a676519e56b973f360850281e7e0d86180dcf8b`](https://github.com/vendurehq/vendure/commit/1a676519e56b973f360850281e7e0d86180dcf8b)
  ("ci(dashboard): Add Playwright e2e test suite (#4355)", 2026-02-15). All
  deep historical evidence therefore comes from the long-lived
  `packages/core/e2e` API suite; browser-level history is about seven months
  long at the pin.

### 2.8 Reproducibility notes

- Run recipe from `packages/dashboard`, per
  [`e2e/README.md`](https://github.com/vendurehq/vendure/blob/a9559073e223794f984cc00fed94d04dd50a47cc/packages/dashboard/e2e/README.md):
  `CI=true VITE_TEST_PORT=5176 npx playwright test --config e2e/playwright.config.ts --reporter=list`.
  The package script is `e2e:pw`. CI uses Node 22 and Bun 1.3.10 via
  `.github/actions/setup/action.yml`.
- Two servers: a Vendure backend started in `global-setup.ts` via
  `@vendure/testing`, and a Vite dev server started by Playwright's `webServer`.
  One shared backend and one shared in-memory database for the whole run.
- [`playwright.config.ts`](https://github.com/vendurehq/vendure/blob/a9559073e223794f984cc00fed94d04dd50a47cc/packages/dashboard/e2e/playwright.config.ts)
  sets `fullyParallel: true`, `workers: 4` under CI, `retries: 1` under CI and
  `trace: 'on-first-retry'`. Combined with `productVariants(take: 1)`, order
  tests share the same variant and therefore the same stock counters. For
  baselines use `--workers=1` and a single grep'd test; enable tracing for
  passing runs explicitly.
- Database evidence must be exported from the live connection before
  `global-teardown.ts`; the sql.js configuration uses `autoSave: false`, so
  there is no on-disk final state to read afterwards.
- No Postgres, MySQL or Redis service is required for the browser suite. No
  Kubernetes anywhere. The heavy part is the monorepo build, not the runtime.

---

## 3. Medusa

Pin: [`f8dce55556a1e68d6ea9b2fb88852b2a76fbd73c`](https://github.com/medusajs/medusa/commit/f8dce55556a1e68d6ea9b2fb88852b2a76fbd73c)
(default-branch head, 2026-09-11T22:47:35Z). Its own subject —
`fix(core-flows): create inventory item when enabling manage_inventory
(#16269)` — is itself an inventory-state fix, which is a fair summary of this
repository's bug profile.

**Disqualifying constraint, unchanged from `benchmark-commerce.md`:** there is
no browser suite. A file-tree scan at the pin returns zero paths matching
`playwright`. What exists is 166 spec files under `integration-tests/http`,
run by the job `HTTP Integration Tests - Shard ${{ matrix.shard_index }}` (4
shards) in
[`.github/workflows/action.yml`](https://github.com/medusajs/medusa/blob/f8dce55556a1e68d6ea9b2fb88852b2a76fbd73c/.github/workflows/action.yml)
via `yarn test:integration:http`, with `postgres` and `redis` service
containers. Sibling jobs cover module and package integration tests.

That said, Medusa has the richest *money and inventory* fix history of the six,
and every finding below modified an already-existing integration spec — so the
feature had coverage that passed.

1. **Reservations created at the wrong point in the draft-order lifecycle.**
   [`3e2991e44719c2a829696215862ae5fbd368fe37`](https://github.com/medusajs/medusa/commit/3e2991e44719c2a829696215862ae5fbd368fe37)
   ("fix(core-flows): create reservations on draft order conversion to regular
   order (#14010)", 2025-12-01). Reservations were created inside
   `confirmDraftOrderEditWorkflow` and moved to `convertDraftOrderWorkflow`.
   The PR body states the consequence plainly: draft edits "would potentially
   block inventory for regular order requests" for a purchase that may never
   materialise. Pre-existing spec modified:
   `integration-tests/http/__tests__/draft-order/admin/draft-order.spec.ts`
   (+199 lines). Class **B** (inventory reserved against a non-order) with
   **E** flavour.
2. **Autocapture fired on a payment that was never authorised.**
   [`14e630faa1c31d37626068004e3f00acad1fd51d`](https://github.com/medusajs/medusa/commit/14e630faa1c31d37626068004e3f00acad1fd51d)
   ("fix(core-flows): only autocapture if payment is authorized successfully
   (#16722)", 2026-09-08). `capturePaymentWorkflow` was run with `payment.id`
   where `authorizePaymentSessionStep` returns `null` for deferred
   authorisation (bank transfer, unconfirmed payment link). Pre-existing spec
   modified: `integration-tests/http/__tests__/payment/store/pending-authorization.spec.ts`,
   which already contained
   `it("should capture payment via webhook when order exists with pending_authorization and action is SUCCESSFUL")`
   and `it("should authorize a pending payment session when provider confirms payment")`.
   Class **B**/**C**.
3. **Missing locking on reservation steps.**
   [`d36790f6ccc1a8d7fa729027f9e9d75ad8c9d418`](https://github.com/medusajs/medusa/commit/d36790f6ccc1a8d7fa729027f9e9d75ad8c9d418)
   ("fix(inventory,core-flows,medusa): add missing locking to reservation steps
   (#15397)", 2026-05-14). Added locking to delete/update reservation steps and
   a `reconcile-inventory-reserved-quantity` workflow — i.e. the reserved
   quantity could drift under concurrency. Pre-existing spec modified:
   `integration-tests/http/__tests__/reservations/admin/reservations.spec.ts`
   (+76 lines). This is the double-decrement shape. Class **B**.
4. **Refund ledger inconsistent on order cancellation, twice.**
   [`2b795b6cc1ca1b0787f014784c9cbf06d6ab6e96`](https://github.com/medusajs/medusa/commit/2b795b6cc1ca1b0787f014784c9cbf06d6ab6e96)
   ("fix(core-flows): credit only successful refunds upon order cancellation
   (#14781)", 2026-02-19) modified the pre-existing
   `integration-tests/http/__tests__/order/admin/order.spec.ts`; and
   [`bd162f7a93e326c73b9929918b5bb9e3a458cc77`](https://github.com/medusajs/medusa/commit/bd162f7a93e326c73b9929918b5bb9e3a458cc77)
   ("fix(core-flows): cancel-order credit line ignores pre-existing refunds
   (#15153)", 2026-04-26) modified the pre-existing
   `integration-tests/http/__tests__/order/admin/order-cancel-credit-line.spec.ts`.
   Credit lines — the order's money ledger — were computed from the wrong set
   of refunds. Class **C** (ledger vs payments) and **B**.

Verdict: excellent bug corpus, wrong test shape for this MVP. Keep Medusa as a
fallback only if the benchmark scope is widened to accept HTTP integration runs
as "E2E", and accept Postgres + Redis + a large yarn monorepo build.

---

## 4. Saleor and Bagisto

Reviewed in a parallel source pass in this same session, to the same standard.
The two load-bearing claims (S1 and B2) were re-verified directly against the
GitHub commit API before being recorded here; the remainder are reported as
cited by that pass and carry the same source-backed-candidate label.

### 4.1 Saleor core — `saleor/saleor`

Pin: [`6e2dc35d0cbc7de85ce3503d5e872e2f672ba70e`](https://github.com/saleor/saleor/commit/6e2dc35d0cbc7de85ce3503d5e872e2f672ba70e)
(branch `main`, 2026-09-11).

This changes the picture from `benchmark-commerce.md`, which assessed Saleor
only through the dashboard's Playwright suite. Saleor core has its **own**
`saleor/tests/e2e` suite that is a real PR gate with **no secrets and no cloud
fixtures**: `.github/workflows/e2e.yml`, workflow `e2e suite`, job `e2e-tests`
named `Run E2E tests`, running `uv run pytest -m "e2e"` with only
`DATABASE_URL=postgres://saleor:saleor@postgres:5432/saleor` and
`SECRET_KEY=ci-test`. 172 `test_*.py` files. Postgres 15 is the only service;
setup is comfortably under 30 minutes, no Kubernetes.

Important qualification: it is **not a browser suite**. `saleor/tests/e2e/conftest.py`
drives GraphQL through Django's in-process test client (`E2eApiClient`), wrapped
in `captureOnCommitCallbacks(execute=True)`, with `CELERY_TASK_ALWAYS_EAGER`
and `--disable-socket`. Same category as Medusa's HTTP integration suite: real
backend, real database, no browser.

**S1 — the e2e test asserted the defect (double-charge).** Verified directly.
Fix commit
[`7b108c39541fa5a6401b3ca13a0a7da0b14f49ed`](https://github.com/saleor/saleor/commit/7b108c39541fa5a6401b3ca13a0a7da0b14f49ed)
("Do not allow to create payment if checkout already has a transaction
(#18069)", 2025-08-21), [PR #18069](https://github.com/saleor/saleor/pull/18069).

- Pre-existing test:
  `saleor/tests/e2e/checkout/test_checkout_create_order_transactions_and_active_payment.py`,
  `test_complete_checkout_with_transaction_and_active_payment_CORE_1601`
  (`@pytest.mark.e2e`), created 2024-06-04 in
  [`0770d15fbf7b430a64914cf16fefe753358796ea`](https://github.com/saleor/saleor/commit/0770d15fbf7b430a64914cf16fefe753358796ea)
  — a PR titled "Prevent performing both transaction and payment checkout
  process at the same time (#16073)". So the earlier fix shipped a test that
  codified the remaining hole, and it ran green for roughly 14 months.
- Assertion that was absent: none — the oracle was **wrong**. The test
  completed the checkout and then asserted
  `assert order_data["transactions"]` *and* `assert order_data["payments"]`,
  certifying that one order carried both a new-API `Transaction` and an
  old-API `Payment` charge. The fix deleted that block (`+11/-23` on that file)
  and replaced it with an assertion that `checkoutPaymentCreate` is rejected
  with `PaymentErrorCode.CHECKOUT_HAS_TRANSACTION`. The CHANGELOG line says the
  combination "leads to inconsistent behavior".
- Class: **B** and **C** — two charge records against one order.

This is the same failure shape as Vendure #1250 (§2.1), where the asserted
`stockMovements` array omitted the `ALLOCATION` entry and so certified the
missing side effect. A wrong oracle is strictly worse than a missing assertion
and is an excellent target for an investigator that reads requirements rather
than test expectations.

**S2 — assertion commented out with a bug-tracker link.** Fix commit
[`11e3199c0d99868998b7e8edd66c9a77a1bc5f09`](https://github.com/saleor/saleor/commit/11e3199c0d99868998b7e8edd66c9a77a1bc5f09)
("Block `orderCreateFromCheckout` mutation when tax error occur (#17258)",
2025-01-17). Pre-existing test:
`saleor/tests/e2e/checkout/taxes/test_order_create_from_checkout_return_tax_error.py`,
`test_order_create_from_checkout_return_tax_error_when_app_not_respond_CORE_2014`.
In the pre-fix file the order-creation step and its `TAX_ERROR` assertions were
commented out under `# BUG: https://linear.app/saleor/issue/SHOPX-1712/ …
uncomment this step when the bug is fixed`; the test stopped at checkout totals
and passed. Symptom: an `Order` row written from a checkout whose tax app
returned an invalid response — class **B**. Caveat: the file was added only ten
days earlier, so "pre-existing" is short-lived.

**S3 — per-line rounding hidden behind aggregate assertions.** Fix commit
[`cf6cfe735a575e1702457cf4afe3365f3812f111`](https://github.com/saleor/saleor/commit/cf6cfe735a575e1702457cf4afe3365f3812f111)
("Fix rounding issue when propagating order/checkout level discount on lines
(#17024)", 2024-11-19). Pre-existing test:
`saleor/tests/e2e/orders/discounts/test_order_products_on_catalog_promotion_and_voucher_entire.py`,
`test_order_products_on_catalog_promotion_and_voucher_entire_order_CORE_2131`,
added 2024-08-30. Before the fix it asserted per-line `unitPrice.gross` and
`unitDiscount` plus **aggregate** subtotal/total, computing the expected
discounted aggregate as a percentage of the aggregate — rounding-blind by
construction. The fix added per-line `totalPrice.gross/net/tax` and per-line
voucher-share arithmetic. Symptom: `OrderLine` price and tax columns off by
0.01 while order-level totals looked right — class **B** with **C**. Caveat:
the fix also *changed* existing aggregate assertions, so this is partly a
wrong-oracle case too.

**S4 — order status asserted from the mutation response, never re-read from the
database.** Fix commit
[`940b8d83ec5c09aa19416c8bcf38d5c28696a991`](https://github.com/saleor/saleor/commit/940b8d83ec5c09aa19416c8bcf38d5c28696a991)
("Fix a bug where Checkout having Transaction and Gift Card couldn't be
completed due to incorrectly raised `CHECKOUT_NOT_FULLY_PAID` error (#18103)",
2025-09-04). Pre-existing test:
`saleor/tests/e2e/checkout/zero_total/test_pay_for_total_checkout_with_gift_card.py`,
`test_gift_card_total_payment_for_checkout_core_1101`, originally added
2023-11-03. It asserted only the `checkoutComplete` **mutation response**. The
fix added a step that re-queries the persisted order, and flipped the
mutation-response expectation — the commit message states that "order status is
initially not correct but is immediately fixed on database transaction on commit
hook". The fix also had to force status recalculation on other checkouts holding
the same gift card. This is the canonical Beyond Green shape: **the API response
and the database disagree**, class **C** plus a gift-card-balance side effect
(**A**) that no e2e test observed.

**Dashboard browser suite: exclude.** `saleor/saleor-dashboard` pin
[`66d28330ed0ad22a4c307049e69ed9c49ffc85cf`](https://github.com/saleor/saleor-dashboard/commit/66d28330ed0ad22a4c307049e69ed9c49ffc85cf)
(2026-09-07, same pin as `benchmark-commerce.md`). The parallel pass found no
fix commit where an app-code change touched a pre-existing `playwright/tests/**`
spec for the same feature, and confirmed and sharpened the blocker already
recorded in `benchmark-commerce.md`: the Playwright suite is **not** in the PR
gate (`.github/workflows/main.yml`, workflow `QA`, runs only typecheck/lint,
jest, translations, storybook, chromatic). It runs only via
`run-tests-on-release.yml` / `run-test-manual.yml`, requires
`STAGING_TOKEN`, `E2E_USER_NAME`, `E2E_USER_PASSWORD`,
`E2E_PERMISSIONS_USERS_PASSWORD`, `MAILPITURL` and a Slack webhook, allocates a
pooled Saleor Cloud instance, has no `webServer` block in
`playwright.config.ts`, and its specs address hardcoded base64 global IDs of
cloud-seeded objects in `playwright/data/e2eTestData.ts`. Not locally
reproducible.

### 4.2 Bagisto — `bagisto/bagisto`

Pin: [`d259fcd5681087fbee236ae62870da849a365fe7`](https://github.com/bagisto/bagisto/commit/d259fcd5681087fbee236ae62870da849a365fe7)
(default branch `2.4`, 2026-09-12). Development branch `master` head is
`41ef8c14607d847ac79c7e06d3698f5614d7bec2`.

Bagisto is the only candidate besides Vendure with a real, self-hosted browser
suite: Playwright specs at
`packages/Webkul/Shop/tests/e2e-pw/tests` (76), `packages/Webkul/Admin/tests/e2e-pw/tests`
(61) and an installer suite, plus 125 Pest/PHPUnit HTTP feature tests under
`tests/Feature/**`.

CI: `.github/workflows/pest-tests.yml` (workflow `Pest Tests`, jobs
`PHP 8.3 - MySQL` / `PHP 8.3 - MariaDB`, `vendor/bin/pest --parallel`) runs on
every push and pull request. `.github/workflows/playwright-tests.yml` (workflow
`Playwright Tests`, 40 matrix legs: Admin/Shop × MySQL/MariaDB × 10 shards) is
**label-gated on pull requests**:
`if: github.event_name != 'pull_request' || contains(github.event.pull_request.labels.*.name, 'Need Playwright Testing')`.
It always runs on `v*` tags and `workflow_dispatch`. No secrets: the job runs
`php artisan bagisto:install`, seeds products, runs the indexer and serves the
app locally.

**B2 — a one-line inventory fix, no test, and a tautological pre-existing
assertion.** Verified directly: the commit's *entire* patch is a single added
line and it touches no test file.

Fix commit
[`5e35f653c3201ada6783b0c8ff2838dd3217982d`](https://github.com/bagisto/bagisto/commit/5e35f653c3201ada6783b0c8ff2838dd3217982d)
("[2.2] fix: issue in returned qty inventory #10205", 2024-10-28), for
[PR/issue #10205](https://github.com/bagisto/bagisto/pull/10205), in
`packages/Webkul/Sales/src/Repositories/OrderItemRepository.php` inside
`returnQtyToProductInventory()`:

```
+                $shippedQty -= $orderItem->qty_invoiced;
```

- Pre-existing test:
  `packages/Webkul/Admin/tests/Feature/Sales/OrdersTest.php`,
  `it('should cancel the order')` (file created 2023-12-27). It posts to the
  cancel route, asserts the redirect, then `assertModelWise([...])` over
  `Cart`, `CartItem`, `Order`, `OrderItem`, addresses and payments.
- Assertion that was absent: **no `product_inventories.qty` assertion exists
  anywhere in the cancel tests** — the exact table the fix corrects. And the
  `OrderItem` assertion cannot fail: the test calls `$orderItem->refresh()` and
  then asserts, via `assertModelWise` (a thin `assertDatabaseHas` in
  `packages/Webkul/Core/tests/Concerns/CoreAssertions.php`), that the row
  matches the model's own just-refreshed attributes — including
  `qty_shipped`, `qty_invoiced`, `qty_canceled`, `qty_refunded`. It asserts a
  row equals itself, so no quantity regression can trip it.
- Symptom: stock inflated when cancelling an order with invoiced-but-unshipped
  quantity — a double-restock. Class **B**.

A test that asserts a row against its own freshly-read values is the purest
example in this whole review of a green test that cannot fail, and it is a
strong demo beat.

**B1 — coupon double-spend under concurrent checkout.** Fix commit
[`1f57c10eb9cb61b37de4706ffa439fd26aa7c405`](https://github.com/bagisto/bagisto/commit/1f57c10eb9cb61b37de4706ffa439fd26aa7c405)
("fix: race condition fixed for cart rule", 2026-03-18),
[PR #11202](https://github.com/bagisto/bagisto/pull/11202). Its own CHANGELOG
entry states the bug shipped: two simultaneous orders could both redeem a
single-use coupon; validation and consumption are now atomic under row-level
locking. Changed `packages/Webkul/CartRule/src/Listeners/Order.php` (read-then-write
`times_used` → `lockForUpdate()` + re-validation + `increment()`), added
`CouponUsageLimitExceededException`, touched `OrderRepository` and
`OnepageController`. The fix added a brand-new
`packages/Webkul/Shop/tests/Feature/Checkout/CouponUsageLimitTest.php`.

Pre-existing coverage that passed: ~24 browser specs under
`packages/Webkul/Shop/tests/e2e-pw/tests/promotion/cart-rules/`, e.g.
`cart-attributes/subtotal.spec.ts` →
`"should apply coupon when subtotal condition is -> is equal to"`. Absent
assertion: at the fix's parent commit, a grep for `usage_limit`,
`usage_per_customer`, `times_used` and `cart_rule_coupon_usage` across
`packages/Webkul/*/tests` returns **zero hits** — nothing in either suite
asserts the coupon ledger. The browser helper `applyCoupon()` in
`packages/Webkul/Shop/tests/e2e-pw/pages/rules.ts` terminates at
`expect(this.locators.couponSuccessMessage).toBeVisible()` — the same
toast-only shape as Vendure's dashboard tests. Class **B**.

Honest caveat, as reported: the coupon browser specs never place an order and
the order-placing checkout specs never apply a coupon, so this is a coverage
gap at a seam plus a total absence of ledger assertions, not one test that
executed the bug and passed. The race itself needs concurrency; only the
missing re-validation at order time is sequentially reproducible.

**B3 (weak) — stale state codes persisted on cart/order addresses.** Fix commit
[`1e05ca9f6b29a174308d6260a1cf205a2ca89155`](https://github.com/bagisto/bagisto/commit/1e05ca9f6b29a174308d6260a1cf205a2ca89155)
(2026-09-12), [PR #11435](https://github.com/bagisto/bagisto/pull/11435). Adds
a `StateBelongsToCountry` rule and new tests immediately after the pre-existing
billing-address tests in
`packages/Webkul/Admin/tests/Feature/Sales/Orders/OrdersTest.php` (+85) and
`packages/Webkul/Shop/tests/Feature/Checkout/CheckoutTest.php` (+84), plus four
new state-validation test files. Persisted-state
symptom, but data-integrity rather than money or inventory, and it landed the
same day as HEAD with a sibling commit, so there is no "shipped in a release"
evidence. Lowest priority.

**Evidence collection.** Bagisto's Playwright path has one real advantage over
Vendure's: it runs against a live, non-transactional MySQL database served by
`php artisan serve`, so `mysqldump` between specs captures true post-scenario
state (snapshot before each spec's `test.afterEach` cleanup, e.g.
`deleteRuleAndProduct()`). The Pest path uses `DatabaseTransactions`
(`tests/TestCase.php`), so per-test writes roll back and would need the trait
disabled or an in-test dump. `playwright.config.ts` sets
`fullyParallel: false, workers: 1`, which is good for determinism.

**Cost.** PHP 8.3 with ~10 extensions, Composer 2, MySQL 8.0 or MariaDB 10.11,
plus Node 22 and Chromium for the browser path. Estimated 20–35 minutes —
at the top of the budget; the Pest-only route is ~15–20. No Kubernetes. A few
tests reference Elasticsearch (`ConfigurableElasticSearchTest.php`) and must
self-skip since CI provisions none.

---

## 5. Spree and Sylius

Both were reviewed and both are **rejected**, for different reasons. The stack
facts below were verified directly against the pinned trees in this pass.

### 5.1 Spree — rejected: there is no browser suite in the current tree

Pin: [`ad37c5af946dc8afbbb62c8ed57d204850f811e7`](https://github.com/spree/spree/commit/ad37c5af946dc8afbbb62c8ed57d204850f811e7)
(default branch, 2026-09-12).

A file-tree scan at that revision finds **zero** files matching
`spec/features/**_spec.rb`, and a repository-wide scan for `capybara`, `system`
or `features` in test paths returns nothing relevant (only a docs plan file and
an unrelated `payout_provider/system.rb` model). Spree's RSpec suite at HEAD is
model, controller, serializer and API-integration specs — the largest
directories are `spree/core/spec/models/spree` (179 spec files),
`spree/api/spec/controllers/spree/api/v3/admin` (93) and
`spree/api/spec/integration/spree/api/v3/*` (roughly 128 across
admin/store/seller). CI is `.github/workflows/tests.yml` plus
`packages.yml`/`release.yml`/`security-audit.yml`.

Whatever Capybara feature coverage Spree had historically, it is not present in
the tree we would pin, so the project's core requirement — "the affected
feature already had E2E/browser test coverage that passed anyway" — cannot be
satisfied against this revision. Combined with adding a Ruby runtime to the
evidence collector, Spree is out. Do not spend further time on it.

### 5.2 Sylius — rejected on cost, not on evidence quality

Pin: [`27ff385b5a5723b24be5e763ebdfe8cfd07d2fe4`](https://github.com/Sylius/Sylius/commit/27ff385b5a5723b24be5e763ebdfe8cfd07d2fe4)
(default branch, 2026-09-09).

Sylius is the opposite case: its end-to-end coverage is enormous and genuinely
behavioural. The pinned tree contains **855 `.feature` files** driven by Behat
(`behat.dist.php`, with the step and client infrastructure under
`src/Sylius/Behat/`), and dedicated end-to-end CI workflows per database —
`.github/workflows/ci_e2e-mysql.yaml`, `ci_e2e-mariadb.yaml`,
`ci_e2e-pgsql.yaml` — alongside `ci__full.yaml`, `ci__minimal.yaml` and
`ci_static-checks.yaml`.

It is rejected purely on integration cost for this hackathon:

- PHP 8 + Symfony + Composer, plus MySQL/MariaDB/PostgreSQL, plus a browser
  driver (Selenium/Panther) for the JavaScript-tagged scenarios. This is the
  heaviest setup of the six and cannot credibly be brought up in ~30 minutes
  alongside everything else.
- Gherkin is a second requirements language. Our requirement extractor and
  evidence collector would need to understand Behat suites, contexts and
  `@javascript` tagging to know which scenarios are browser-driven and which
  are API-driven, which is real work with no payoff for the demo.
- Adding a PHP runtime to the evidence collector duplicates the cost already
  accepted for Bagisto (§4.2) without adding evidence quality that Vendure and
  Saleor do not already provide.

Keep Sylius on file as the best candidate if the project ever needs a
*specification-rich* benchmark — 855 executable scenarios is an unusually good
source of machine-readable business requirements for the requirement-extraction
half of the loop. It is not the right second benchmark now.

---

## 6. Does anything displace Vendure?

No. **Vendure remains the right second benchmark**, and this pass strengthens
rather than weakens that choice:

- It is the only candidate in the domain with a real, currently-running browser
  suite over its own product UI plus a real backend and a snapshot-able
  database, with no service containers needed.
- It supplies the best historical evidence found anywhere in this review — the
  #1198 → #1250 → #2306 sequence, where one e2e test covering exactly the
  feature under discussion stayed green across three shipped releases while
  half of a persisted stock invariant was missing, and where the decisive fix's
  only test change was to add the absent `stockAllocated` assertions.
- Its browser tests assert almost nothing beyond a non-error toast, so the
  injected-regression surface is wide and the "the test passed, did the system
  behave correctly?" framing is literal rather than contrived.

The competition, ranked honestly:

- **Saleor core** (§4.1) is a real surprise and the strongest *runner-up*. Its
  `saleor/tests/e2e` suite is an always-on PR gate with zero secrets and a
  single Postgres container, and it yields the best single artefact in the whole
  review: a test that asserted the double-charge defect (`assert
  order_data["transactions"]` *and* `assert order_data["payments"]`) for
  roughly 14 months. But it drives GraphQL in-process through Django's test
  client — no browser, no HTTP layer, no Celery — so it is an API suite, and
  pytest-django rolls each test back, so DB snapshotting needs deliberate work.
  Promote it above Medusa in the reserve list; do not promote it above Vendure.
- **Bagisto** (§4.2) is the only other candidate with a real self-hosted browser
  suite, and B2's cancel-order test — which asserts a database row against that
  row's own freshly-read values — is the most vivid "green test that cannot
  fail" in the review. Against it: a PHP/Laravel toolchain, a browser suite that
  is label-gated on PRs, and 20–35 minutes of setup.
- **Medusa** (§3) has the deepest money and inventory bug corpus of the six and
  no browser suite at all, plus Postgres and Redis.
- **Saleor dashboard** is excluded outright (private cloud fixtures).
- **Spree and Sylius** (§5) add a second language runtime to the evidence
  collector for no gain in evidence quality.

One cross-project pattern is worth carrying into the requirement extractor: in
three of the four strongest findings — Vendure #1250, Saleor #18069 and Saleor
#17024 — the test did not merely omit an assertion, it **asserted the wrong
thing**, certifying the defective state. A green suite is therefore not just
silent about these bugs, it actively vouches for them. That is an argument for
deriving the invariant from source comments and documented business rules rather
than from test expectations.

Two changes to the plan in `benchmark-commerce.md` are recommended:

1. Replace the first regression's invented invariant with the **cited** one from
   §2.1, and resolve the `trackInventory` problem in §2.5 before injecting
   anything. As written, the proposed mutation is probably inert.
2. Add the refund case from §2.2 as the second Vendure regression, using the
   persisted `refund`/`refund_line` rows as the observable, since
   `should process a refund` asserts only a toast.

---

## 7. Not verified

Everything in this section is an open question, not a finding. No application
in this document was installed, built, seeded, or run during this research, and
no baseline or mutant execution took place.

**Not verified — runtime behaviour**

1. That any cited test actually passes at the pinned revision. Test *presence*
   and test *content* were read from the source; pass/fail was not observed.
2. That the upstream `dashboard-e2e` suite is green at
   `a9559073e223794f984cc00fed94d04dd50a47cc` on a local machine, or that its
   two-server setup starts at all outside CI.
3. That `productVariants(options: { take: 1 })` resolves to SKU `L2201308` at
   runtime. The default ordering of that query was not traced; the conclusion
   in §2.5 assumes seed/insert order. If it resolves to a different row the
   `trackInventory` analysis must be redone — but note 33 of 34 seeded variants
   are `false`, so the conclusion is robust to most orderings.
4. That flipping a seeded variant's `trackInventory` through the Admin API
   (§2.5, option 2) makes the `createSalesForOrder` stock mutation observable,
   and that doing so does not perturb other tests sharing the same database.
5. That any proposed injection leaves the browser test passing. Every mutation
   named here is a hypothesis about test blindness, not a demonstrated one.
6. A scan of all 628 test/spec/e2e `.ts` files in the monorepo at the pin found
   **zero** references to `StockMovementEvent`; within `packages/core/e2e` there
   are **eight** references to `ORDER_FULFILLMENT_TRANSITION`, all in
   `order.e2e-spec.ts`. So of the two mutation sites floated in §2.5 option 1,
   suppressing the `StockMovementEvent` publish is unasserted by name anywhere
   and suppressing the fulfilment history entry is not. Still not verified: that
   the event has no *indirect* assertion (a test that observes a downstream
   consequence without naming the event class), and that a suppressed event
   yields evidence our harness can actually retrieve — that requires an event-bus
   subscriber we have not written.

**Not verified — historical claims**

7. The masking mechanism for #2306. The wrong-id lookup plausibly resolved to a
   valid but incorrect `OrderLine` because fulfilment-line and order-line ids
   coincide in a small seeded database, which would explain why the e2e test
   passed while users saw an error. This is a hypothesis; it was not reproduced.
8. Whether the 2021-era `e2e tests` CI job actually executed
   `stock-control.e2e-spec.ts` on the specific commits that shipped 1.3.1 and
   1.3.4. The job and its `yarn e2e` command were read from the workflow file
   at the fix commit; individual historical CI run logs were not retrieved.
9. Whether #1250 and #2306 were ever reproduced against a clean upstream
   checkout by anyone other than the reporters.

**Not verified — second-hand within this pass**

Findings for Saleor, Bagisto, Spree and Sylius came from a parallel source
review in this same session. Four claims were re-checked directly against the
GitHub commit API and are confirmed: Saleor S1 (the `assert
order_data["transactions"]` / `assert order_data["payments"]` block and its
replacement), Saleor S2 (the commented-out `TAX_ERROR` assertions, read
verbatim), Bagisto B2 (the single-line patch with no test file touched), and
Bagisto B1's changed file list. The following were **not** independently
re-verified here and rest on that pass's reading:

S4 was subsequently re-verified directly too: the pre-existing
`test_gift_card_total_payment_for_checkout_core_1101` asserted
`order_data["status"] == "UNFULFILLED"` straight off the `checkoutComplete`
mutation response, and the fix changed it to `"UNCONFIRMED"` and added an
`order_query` re-read. S3's e2e file was confirmed as *modified* (`+123/-24`),
consistent with assertions being both added and corrected. The `assertModelWise`
tautology in B2 was confirmed to have exactly one definition in the Bagisto tree
(`packages/Webkul/Core/tests/Concerns/CoreAssertions.php:24`), so no override
could invalidate it. Still resting on the parallel pass's reading:

- The creation dates attributed to Saleor's S3 and S4 test files, and S3's
  pre-fix per-line vs aggregate assertion content in detail.
- Bagisto B1's zero-hit grep for `usage_limit` / `times_used` /
  `cart_rule_coupon_usage` across `packages/Webkul/*/tests` at the fix's parent,
  and the exact browser test name cited from `cart-attributes/subtotal.spec.ts`.
- The CI workflow details for Saleor and Bagisto — job names, triggers, secret
  lists and service containers.

The Spree and Sylius conclusions in §5 were verified here directly (file-tree
scans of the pinned trees for feature/system specs, `.feature` files, Behat
configuration and workflow files). What was *not* done for those two is a search
of their issue histories for assertion gaps: Spree because no browser suite
exists to have missed anything, Sylius because it is rejected on integration
cost regardless of what its history contains. If Sylius is ever reconsidered,
that history search is still owed.

**Not verified — environment**

10. Local build time and disk cost for the Vendure monorepo, the Medusa
    monorepo, and the Chromium install. The "roughly 30 minutes" target is not
    a measurement.
11. Docker daemon availability (noted as not running in
    `benchmark-selection.md`), which Medusa and Saleor both need.
12. That database state can in fact be exported from the live sql.js connection
    before `global-teardown.ts` runs. This is the plan; the mechanism has not
    been written or tested.

**Explicitly out of scope**

13. No agent, investigator, or test-analysis implementation was read from or
    copied out of any reviewed project. Twenty's adjacent prior art remains
    acknowledged in `benchmark-products.md` and untouched here.
