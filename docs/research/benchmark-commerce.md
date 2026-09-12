# Commerce benchmark candidates

Researched 2026-09-12 against primary GitHub source, including complete repository file trees. No application was installed or executed. Rankings and proposed mutations are engineering judgments; none is a demonstrated green-test regression yet.

## Recommendation: Vendure first

1. **Vendure dashboard + core**: strongest fit of these three. Real browser suite, backend and embedded SQL database, existing CI setup, and a concrete fulfillment assertion gap.
2. **Saleor dashboard + core**: real browser coverage and excellent DB/worker/email evidence, but upstream E2E provisioning depends on private cloud fixtures. Local reproduction needs adaptation.
3. **Medusa core**: substantial real backend integration coverage, but the inspected core and official Next.js starter do not supply the existing browser suite required by this MVP.

## Vendure

Pin: [`a9559073e223794f984cc00fed94d04dd50a47cc`](https://github.com/vendurehq/vendure/commit/a9559073e223794f984cc00fed94d04dd50a47cc).

This is the commerce product's actual admin dashboard and backend, using seeded data and test payment handlers; it is not an independently authored sample storefront. The [browser setup](https://github.com/vendurehq/vendure/blob/a9559073e223794f984cc00fed94d04dd50a47cc/packages/dashboard/e2e/global-setup.ts) starts a Vendure server with `@vendure/testing`, products and five customers. Its [Playwright configuration](https://github.com/vendurehq/vendure/blob/a9559073e223794f984cc00fed94d04dd50a47cc/packages/dashboard/e2e/playwright.config.ts) builds and serves the real dashboard, authenticates an admin, and runs Chromium. Distinguish this suite from `packages/core/e2e`, which tests the backend API.

Setup burden is moderate monorepo build work, but low service overhead: [test configuration](https://github.com/vendurehq/vendure/blob/a9559073e223794f984cc00fed94d04dd50a47cc/packages/testing/src/config/test-config.ts) uses sql.js with `autoSave: false`. The browser suite has no PostgreSQL/Redis service requirement. Logging is disabled by default; `LOG=true` enables it. Asset storage is a test substitute, so do not select durable asset storage as the first regression claim. Database evidence must be exported from the running connection before teardown; the seed/cache file is not necessarily the final runtime state.

The existing [GitHub Actions dashboard job](https://github.com/vendurehq/vendure/blob/a9559073e223794f984cc00fed94d04dd50a47cc/.github/workflows/build_and_test.yml#L122) installs dependencies, builds `@vendure/testing` and dependencies, installs Chromium, and runs `bun run e2e:pw` over four shards. [Shared setup](https://github.com/vendurehq/vendure/blob/a9559073e223794f984cc00fed94d04dd50a47cc/.github/actions/setup/action.yml) specifies Node 22 and Bun 1.3.10. Start with one worker and one test, then expand after a stable baseline. Enable traces for passed runs because the upstream configuration only records the first retry.

### First regression candidate: fulfillment does not consume inventory

Existing browser test: [`should fulfill an order`](https://github.com/vendurehq/vendure/blob/a9559073e223794f984cc00fed94d04dd50a47cc/packages/dashboard/e2e/tests/sales/orders.spec.ts#L632). It prepares a paid order through the real Admin API, navigates to it, opens the fulfillment dialog, verifies quantity controls, submits, and finally checks visibility of the first toast excluding text matching `/error/i`. It does **not** assert stock levels or stock movement records.

Source-backed business invariant: [`StockMovementService.createSalesForOrder`](https://github.com/vendurehq/vendure/blob/a9559073e223794f984cc00fed94d04dd50a47cc/packages/core/src/service/services/stock-movement.service.ts#L198) creates Sale records and, for tracked variants, reduces both allocated stock and stock on hand. [`OrderService.createFulfillment`](https://github.com/vendurehq/vendure/blob/a9559073e223794f984cc00fed94d04dd50a47cc/packages/core/src/service/services/order.service.ts#L1765) transitions the fulfillment to Pending; the [default fulfillment process](https://github.com/vendurehq/vendure/blob/a9559073e223794f984cc00fed94d04dd50a47cc/packages/core/src/config/fulfillment/default-fulfillment-process.ts#L94) calls the stock service on Created → Pending.

**Proposed injection:** omit only `updateStockOnHandForLocation` in `createSalesForOrder`, leaving Sale persistence, allocated stock changes, and API response intact. Expected hidden defect: a successful fulfillment and negative Sale movement coexist with unchanged stock on hand. This is a hypothesis until baseline and mutant runs prove it. Confirm that the selected seeded variant tracks inventory before accepting this mutation.

Evidence to capture: browser result and mutation response; order/fulfillment IDs; variant and stock location IDs; before/after stock level; Sale quantity; application logs; explicit inventory requirement extracted from the source comment. Export these before global teardown. The deterministic comparison should reconcile quantities; the model should investigate why the successful UI and stock state disagree. Keep the upstream test unchanged.

Run selection from `packages/dashboard`: `CI=true LOG=true bunx playwright test --config e2e/playwright.config.ts e2e/tests/sales/orders.spec.ts --grep 'should fulfill an order' --workers=1`. Build and browser prerequisites should mirror the cited CI job. This command has not been run here.

## Saleor

Dashboard pin: [`66d28330ed0ad22a4c307049e69ed9c49ffc85cf`](https://github.com/saleor/saleor-dashboard/commit/66d28330ed0ad22a4c307049e69ed9c49ffc85cf). Local platform pin: [`ab6315bd59c58b4815175df4c679107ff9695be4`](https://github.com/saleor/saleor-platform/commit/ab6315bd59c58b4815175df4c679107ff9695be4).

The real [dashboard browser suite](https://github.com/saleor/saleor-dashboard/blob/66d28330ed0ad22a4c307049e69ed9c49ffc85cf/playwright.config.ts) uses Chromium, auth setup, and a supplied base URL. Example: [`SALEOR_199 Create customer`](https://github.com/saleor/saleor-dashboard/blob/66d28330ed0ad22a4c307049e69ed9c49ffc85cf/playwright/tests/customers.spec.ts#L33) fills customer and address details, then verifies the success banner, name, email, and note. It does not query DB address persistence. A missing address record while customer fields remain correct is a candidate gap, but the corresponding backend mutation has not been traced or tested in this bounded review.

The [local platform Compose file](https://github.com/saleor/saleor-platform/blob/ab6315bd59c58b4815175df4c679107ff9695be4/docker-compose.yml) includes Saleor API/dashboard 3.23 images, PostgreSQL 15, Valkey, Celery worker, Jaeger and Mailpit. The [README](https://github.com/saleor/saleor-platform/blob/ab6315bd59c58b4815175df4c679107ff9695be4/README.md) documents migrations, sample-data population, admin creation and a 5 GB Docker memory allocation. These provide strong evidence sources, but the platform uses image tags rather than the dashboard source pin above, so compatibility must be resolved before benchmarking.

Critical obstacle: the upstream [manual E2E workflow](https://github.com/saleor/saleor-dashboard/blob/66d28330ed0ad22a4c307049e69ed9c49ffc85cf/.github/workflows/run-test-manual.yml) restores Saleor Cloud instances/backups and uses private account/password and 1Password secrets. A normal local populated database is not proven to match its named fixture IDs. Prefer Vendure for the first baseline; reserve Saleor for later backend/worker/email diversity.

## Medusa

Core pin: [`f8dce55556a1e68d6ea9b2fb88852b2a76fbd73c`](https://github.com/medusajs/medusa/commit/f8dce55556a1e68d6ea9b2fb88852b2a76fbd73c). Official starter pin: [`9818886f06e493cb2249733d114d339aa216ef00`](https://github.com/medusajs/nextjs-starter-medusa/commit/9818886f06e493cb2249733d114d339aa216ef00).

Medusa is a real commerce backend. Its [CI](https://github.com/medusajs/medusa/blob/f8dce55556a1e68d6ea9b2fb88852b2a76fbd73c/.github/workflows/action.yml#L273) runs HTTP integration tests with PostgreSQL and Redis. The [store order test](https://github.com/medusajs/medusa/blob/f8dce55556a1e68d6ea9b2fb88852b2a76fbd73c/integration-tests/http/__tests__/order/store/order.spec.ts) uses Jest and `medusaIntegrationTestRunner`, creates data through API/container helpers, and asserts HTTP response objects. It is **not a browser E2E test**. For example, successful non-draft order retrieval checks that the response contains the order ID, without examining payment or inventory state.

The inspected [core tree](https://github.com/medusajs/medusa/tree/f8dce55556a1e68d6ea9b2fb88852b2a76fbd73c) contained no Playwright-named files, and the [official Next.js starter tree](https://github.com/medusajs/nextjs-starter-medusa/tree/9818886f06e493cb2249733d114d339aa216ef00) contained no E2E suite or GitHub workflow files. This is a scoped finding, not a claim that no Medusa browser suite exists anywhere. Adding one ourselves would violate the preferred existing-test constraint and introduce extra storefront/backend setup work. Do not lead with Medusa unless the benchmark scope explicitly accepts HTTP integration runs.
