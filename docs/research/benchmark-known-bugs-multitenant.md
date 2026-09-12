# Benchmark candidates: multi-tenant and permission-boundary leakage

Research date: 2026-09-12. Domain: systems where cross-user or cross-tenant
leakage has actually been reported. Purpose: find held-out, historically real
assertion gaps that would extend the Beyond Green benchmark into regression
classes **C (conflicting sources)** and **E (state leakage)**, which the current
Linkding benchmark does not cover.

Scope note: Linkding is already in use and is deliberately not re-recommended.
Twenty was already reserved in [benchmark-selection.md](benchmark-selection.md);
this document goes deeper on it rather than re-introducing it.

**Every finding below is a source-backed candidate.** Nothing here was executed.
No application was installed, no test was run, no baseline or mutant was
captured, and no leak was observed. Each claim is a reading of pinned upstream
source, a pinned commit diff, or a published advisory. Where a candidate's
behaviour under a Beyond Green capture is an inference, the "Unverified" line in
its section says so. Findings are reported as research: advisories and fixes are
cited, and no exploitation procedure is reproduced.

## Shortlist

| App | Pinned revision | Stack | E2E / integration framework | Database | Best historical gap | Class | Setup cost | Main risks |
|---|---|---|---|---|---|---|---|---|
| **Directus** | [`dc922b790a15949e8abfce9c1f4523d4e5f89492`](https://github.com/directus/directus/tree/dc922b790a15949e8abfce9c1f4523d4e5f89492) (main, 2026-09-11) | Node 22 / TypeScript / Express, pnpm 10 monorepo | `tests/e2e` (Vitest + real server via `@directus/sandbox`), `tests/blackbox` (Vitest + supertest, real server) | SQLite, Postgres, MySQL, MariaDB, MSSQL, Oracle, CockroachDB | Side effects committed **before** the permission check: a rejected `DELETE` still mutated rows (GHSA-p623-wgx3-wxp8, fix [`6d6a7af`](https://github.com/directus/directus/commit/6d6a7af3d460aad50441bdbe3b8613d684b63352)) | **A + B + E** | Medium-high: full monorepo build + Docker sandbox (redis, minio, maildev, saml, mock license) | Build is the cost centre (CI hints 6 GB heap, concurrency 2); likely 20-45 min, above the 30-min target |
| **Rocket.Chat** | [`d6956ab50f206a47d57c45c6e4d59041828ebcce`](https://github.com/RocketChat/Rocket.Chat/tree/d6956ab50f206a47d57c45c6e4d59041828ebcce) (develop, 2026-09-12) | Meteor / Node / TypeScript monorepo | `apps/meteor/tests/end-to-end/api` (Mocha + supertest), `apps/meteor/tests/e2e` (Playwright) | MongoDB (replica set required) | Any authenticated user could convert **another owner's** public channel into a team via the `channelName` path (GHSA-4mvx-9h2h-hmg3, fix [`175a19c`](https://github.com/RocketChat/Rocket.Chat/commit/175a19c4151f41910499ef37df54f58022276d12)) | **A + B + E** | High | Meteor build + Mongo replica set; CI pulls prebuilt images from GHCR with org secrets, so local reproduction is the slow path |
| **Twenty** | [`b782836bca6841bf735026d2223bbb22a65019a6`](https://github.com/twentyhq/twenty/tree/b782836bca6841bf735026d2223bbb22a65019a6) (main, 2026-09-12) | Node 24 / NestJS / Nx monorepo | `packages/twenty-e2e-testing` (Playwright), `packages/twenty-server/test/integration` (Jest, real GraphQL + DB) | Postgres 18 + Redis | Field-level read permission enforced on output but **not** on the filter predicate, turning `totalCount` into an oracle (GHSA-v93q-4jcx-7p9m, fix [`a5108d5`](https://github.com/twentyhq/twenty/commit/a5108d512f754a937860bda5e0c2c40c7266e19e)) | **C** | High | Postgres + Redis + Nx builds + seeded workspace + separate worker; already flagged as high burden |
| **Strapi** | [`34fdea8fb4e11afc475a0ffdc14311cce09ddded`](https://github.com/strapi/strapi/tree/34fdea8fb4e11afc475a0ffdc14311cce09ddded) (develop, 2026-09-11) | Node 20-26 / Koa / TypeScript, yarn 4.12.0 monorepo | `tests/api` (Jest against a generated real app), `tests/e2e` (Playwright) | SQLite (default), Postgres, MySQL | Three-times-repeated private-field filtering leak, latest via relational traversal (GHSA-rjg2-95x7-8qmx / CVE-2026-27886) | **C** | Low-medium: `api_ce_sqlite` job needs no service containers | Best gap is a read-only leak, so it adds C but not E; exact 5.37.0 remediation commit not pinned |
| NocoDB | [`588d51381ec28a8e4811450cd7155ccd51bba8c6`](https://github.com/nocodb/nocodb/tree/588d51381ec28a8e4811450cd7155ccd51bba8c6) (develop, 2026-09-12) | Node 24 / NestJS / Nuxt | **None in the OSS repo** | SQLite / Postgres | Cross-workspace integration use (GHSA-96fh-m4r8-6v9v); stale auth cache after token deletion (GHSA-f76x-f9vj-92jv) | E (unusable) | n/a | **Disqualified**: no `tests/` directory at this revision, code search for `playwright` in path returns 0 results, CI runs only Nest unit tests and Swagger validation |
| Appwrite | [`a410fc2ba96529481416dd633d62f0082a4dbfdd`](https://github.com/appwrite/appwrite/tree/a410fc2ba96529481416dd633d62f0082a4dbfdd) (main, 2026-09-12) | PHP / Utopia, Docker Compose | `tests/e2e` (PHPUnit HTTP tests) | MariaDB + Redis | None found in this pass | n/a | Medium-high | The repo publishes no GitHub security advisories; the four advisory-DB rows are path traversal, SSRF, XSS and prototype pollution, none cross-tenant with identifiable pre-existing coverage |

Recommendation: **Directus first**, Rocket.Chat second on the strength of its
gap but not on cost, Strapi as the cheap way to add class C alone. NocoDB is out.

---

## 1. Directus — primary candidate

Pin: [`dc922b790a15949e8abfce9c1f4523d4e5f89492`](https://github.com/directus/directus/tree/dc922b790a15949e8abfce9c1f4523d4e5f89492)
(main, 2026-09-11). Licence: the repository ships a `license` file at root;
confirm its exact terms before publication.

Directus is the best fit in this domain for three reasons. It has a real
multi-identity permission model (users, roles, policies, shares) with a
documented permission contract. It has **two** upstream suites that run a real
server against a real database and can be snapshotted before teardown. And it
has an unusually dense stream of recent, well-written advisories in exactly the
shapes the brief asks for: side effects applied before authorization, a shared
cache with an unsegmented key, and cross-user file overwrite.

### Existing suites and CI

- `tests/e2e` — Vitest, real Directus process per database project, started by
  `@directus/sandbox`. Entry point is `pnpm test` = `vitest --project sqlite`
  ([package.json](https://github.com/directus/directus/blob/dc922b790a15949e8abfce9c1f4523d4e5f89492/tests/e2e/package.json)).
  GitHub Actions: [`.github/workflows/e2e.yml`](https://github.com/directus/directus/blob/dc922b790a15949e8abfce9c1f4523d4e5f89492/.github/workflows/e2e.yml)
  runs a 7-vendor x sandbox matrix.
- `tests/blackbox` — Vitest + supertest, spawns Directus with explicit env per
  case. GitHub Actions: `blackbox.yml` / `blackbox-pr.yml`.
- Build path: [`.github/actions/prepare/action.yml`](https://github.com/directus/directus/blob/dc922b790a15949e8abfce9c1f4523d4e5f89492/.github/actions/prepare/action.yml)
  — `pnpm install` then `pnpm run build` with
  `NODE_OPTIONS=--max_old_space_size=6144` and
  `npm_config_workspace_concurrency=2`.

Evidence sources this gives Beyond Green for free: HTTP traffic through the SDK,
the application log, the live database, and — because the e2e sandbox starts
`maildev`, `redis`, `minio`, `saml` and a mock license server
([global-setup-one.ts](https://github.com/directus/directus/blob/dc922b790a15949e8abfce9c1f4523d4e5f89492/tests/e2e/setup/global-setup-one.ts)) —
email events, cache state and object storage as well.

### Finding D1 — side effects committed before the permission check (strongest)

**Source-backed candidate. Covers class E (and A, B).**

- Advisory: [GHSA-p623-wgx3-wxp8](https://github.com/directus/directus/security/advisories/GHSA-p623-wgx3-wxp8),
  medium, published 2026-08-05, vulnerable `< 12.1.0`, patched `12.1.0`.
- Fix commit: [`6d6a7af3d460aad50441bdbe3b8613d684b63352`](https://github.com/directus/directus/commit/6d6a7af3d460aad50441bdbe3b8613d684b63352)
  ("Fix side effects in service overrides", PR #27800, 2026-07-01).
  Parent: `b5d25aa325dd28ef8a8dd65631af00d0e6df1001`.

What the bug was, in the advisory's own words: several service classes override
`ItemsService` mutation methods to do cleanup work *before* delegating to the
superclass, and the caller's permission check runs *inside* the superclass. When
the superclass then returned `403 Forbidden`, the cleanup had already been
committed. `FlowsService.deleteMany` nullified `resolve` and `reject` on every
`directus_operations` row of the target flow; `UsersService.deleteMany` stripped
authorship metadata from `directus_comments`, `directus_notifications` and
`directus_versions` rows belonging to a user the caller could not delete;
`SharesService.updateMany` / `deleteMany` flushed the global permissions cache
(process-local, and Redis-shared where configured) for any path-valid UUID.

The fix inserts `validateAccess(...)` ahead of the side effect. In
`api/src/services/flows.ts` the new block lands immediately before the line
`await this.knex('directus_operations').update({ resolve: null, reject: null }).whereIn('flow', keys);`,
and the equivalent block lands in `api/src/services/users.ts` before the
user-integrity cleanup.

**Pre-existing coverage that passed anyway.**
[`tests/e2e/tests/permissions/permissions.test.ts`](https://github.com/directus/directus/blob/dc922b790a15949e8abfce9c1f4523d4e5f89492/tests/e2e/tests/permissions/permissions.test.ts)
is a real two-identity permission E2E test: it creates a restricted user with a
static token plus a policy, and drives both an admin SDK client and a
`userApi` client against a live server. Its tests are named
`reading with admin permissions`, `crud with no permissions`,
`crud with create permissions`, `crud with read permissions`,
`crud with update permissions` (twice), `read with fields with access to id`,
`read with fields with access to id, category`, and
`deduplicates primary keys when validating item access`.

**The specific assertion that was absent:** every denied operation is asserted
only as `await expect(() => userApi.request(...)).rejects.toThrowError();`.
There is no post-condition on persisted state after a rejection. The suite never
asserts that a `403` left the database unchanged, and it never asserts that a
rejected mutation on one principal's row did not touch another principal's rows.

**Evidence that the gap is held out.** The fix commit touches five application
files and exactly one test file, `api/src/services/users.test.ts`, for a single
added line — `vi.mock('../permissions/modules/validate-access/validate-access.js');`
— which only keeps an existing unit test compiling against the new import. No
assertion about side-effect ordering was added anywhere, at the unit level or the
E2E level. Upstream therefore still has no test that fails if a side effect is
moved back ahead of the authorization check. That is evidence category 3 from the
brief (application code changed for a feature with existing coverage, no test
added), with the added strength that the pre-existing E2E test demonstrably
exercises the denied-mutation contract and asserts only the rejection.

Why this maps to Beyond Green: the symptom is persisted state produced by an
operation the API reported as forbidden. The HTTP evidence says `403`; the
database evidence says rows changed. That is a genuine class C contradiction
between sources on top of class A/B/E damage, and it is precisely the shape a
cheap model struggles with, because the natural reading of a `403` is "nothing
happened".

**Unverified:** that the mutated code path can be reached from an unchanged
upstream test while that test still passes. `permissions.test.ts` operates on a
custom `trains` collection through the generic `ItemsService`, whereas the
historical defect lived in the `directus_flows` / `directus_users` /
`directus_shares` subclasses. Whether a faithful reintroduction of the ordering
defect is observable during an unchanged upstream test run, and in which suite,
has not been established.

### Finding D2 — response cache served across identities from an unsegmented key

**Source-backed candidate. Covers classes C and E.**

- Advisory: [GHSA-c6w9-5g5j-jh2p](https://github.com/directus/directus/security/advisories/GHSA-c6w9-5g5j-jh2p),
  high, published 2026-06-24, vulnerable `< 12.0.0`, patched `12.0.0`.
- Fix commit: [`7ba4efb97525d3af33570537c76e44baea767f13`](https://github.com/directus/directus/commit/7ba4efb97525d3af33570537c76e44baea767f13)
  ("Add share to cache key", PR #27707, 2026-06-10).
  Parent: `e522e0251f46ceb8578421038a679cc379ac0f22`.

The cache key derived in `api/src/utils/get-cache-key.ts` included only
`version`, `path`, `query`, `accountability.user` and a conditional `ip`.
Share-token authentication issues a JWT without an `id` claim, so
`accountability.user` stayed `null` for every share and for every anonymous
request. Two different shares, or a share and an anonymous client, hitting the
same URL with the same query therefore computed the **same** cache key, and the
second request received the first request's permission-filtered payload with no
re-evaluation. The advisory notes the leak persists for `CACHE_TTL` and, with
`CACHE_STORE=redis`, survives restarts. Precondition: `CACHE_ENABLED=true`, which
does not ship as the default.

This is exactly the brief's "shared cache leaking data between tenants".

**Pre-existing coverage that passed anyway — two layers.**

1. Unit: `api/src/utils/get-cache-key.test.ts` has existed since
   [`19424feefafe5a32f7f34f8c39b1d8da1ddf1828`](https://github.com/directus/directus/commit/19424feefafe5a32f7f34f8c39b1d8da1ddf1828)
   (PR #7416, 2021-08-16). At the fix's parent it contained a test literally
   named **`should create a unique key for each request`**. That test could never
   fail. Its body was:

   ```ts
   const keys = cases.map(async ([, params]) => await getCacheKey(params as unknown as Request));
   const hasDuplicate = keys.some((key) => keys.indexOf(key) !== keys.lastIndexOf(key));
   expect(hasDuplicate).toBeFalsy();
   ```

   `cases.map(async ...)` produces an array of distinct Promise objects, so
   `indexOf`/`lastIndexOf` compare object identities that are unique by
   construction. `hasDuplicate` was always `false`. A green suite asserted
   cache-key uniqueness while asserting nothing at all. The fix rewrote it to
   `expect(new Set(keys).size).toBe(keys.length)` over awaited values and added a
   `share scoping` describe block with five named assertions, including
   `two different shares on the same URL produce different keys` and
   `a share request does not collide with an anonymous request on the same URL`.
   The application change is one line.

2. Integration: [`tests/blackbox/tests/db/app/cache.test.ts`](https://github.com/directus/directus/blob/dc922b790a15949e8abfce9c1f4523d4e5f89492/tests/blackbox/tests/db/app/cache.test.ts),
   added in [`df44649f94aa197ba528612c95d082e0ecaaba73`](https://github.com/directus/directus/commit/df44649f94aa197ba528612c95d082e0ecaaba73)
   (PR #21078, 2024-01-14) and last modified in
   [`79cd1b57d9739e62ae2b25c777958d05d96f35df`](https://github.com/directus/directus/commit/79cd1b57d9739e62ae2b25c777958d05d96f35df)
   (2026-01-07) — that is, **before** the fix and untouched by it. It is a real
   caching integration test: it spawns four Directus servers per vendor with
   `CACHE_ENABLED=true` across memory and Redis stores, with and without
   `CACHE_AUTO_PURGE`. Its describes are `Does not purge cache browsing app
   without Referer header`, `Does not purge cache when browsing app with Referer
   header`, `Purges cache when item is mutated`, `Purges cache when item is
   mutated with Referer header`, and `Purges cache when item is mutated with an
   external Referer header`.

   **The specific assertions that were absent:** every case asserts only
   `response.statusCode` and `response.headers['x-cache-status']` being `HIT` or
   `MISS`. The test never asserts anything about the response **body**, and every
   request in the file is made with `USER.ADMIN.TOKEN` — a single identity. There
   is no share-token request, no anonymous request, and no second user anywhere
   in the caching integration test. Cache correctness was tested purely as an
   invalidation-timing property, never as an authorization property.

Note the residual gap at the pinned revision: `get-cache-key.ts` still keys on
`version`, `path`, `query`, optional flow `rawQuery`, optional `share` and
optional `ip`. `role`, `roles`, `admin`, `app` and `policies` — all named in the
advisory as authorization context absent from the key — are still not in the key.

**Unverified:** whether this gap can be staged as a green Beyond Green capture.
The e2e sandbox sets `cache: false` and does not set `CACHE_ENABLED`, so response
caching is off in `tests/e2e` by default; enabling it is a harness env override
(legitimate, and exactly what the upstream blackbox test does) rather than a test
change. More importantly, the blackbox cache test drives one identity, so a
reintroduced key-segmentation defect would produce no cross-identity leak
*during that test's own run*. Staging this case would require a capture in which
two identities read the same URL, which no current upstream test does. Treat D2
as the best documented historical gap in this domain and the weaker of the two
Directus candidates to stage.

### Finding D3 — global-access permission cache ignored the client IP (same family)

**Source-backed candidate. Covers classes C and E.**

Fix commit: [`ea25ba63db11d4e25c0b1a4e5b8926a64dadbfee`](https://github.com/directus/directus/commit/ea25ba63db11d4e25c0b1a4e5b8926a64dadbfee)
("Fix the global access cache ignoring the client IP", PR #28190, 2026-09-03),
parent `1d85ce292bc3c1c2d8d1548319acc667ff1bdfd4`. Changeset text: "Fixed the
global access cache ignoring the client IP."

`fetchGlobalAccess` passed `ip` through a context argument that the cache-key
builder never read, so the `withCache('global-access', ...)` key omitted it
entirely — meaning an IP-restricted policy decision cached for one client could
be reused for a client at a different address. The application diff is `+1/-2`:
`({ user, roles }, { ip })` became `({ user, roles, ip })`. The fix added a
brand-new test file `fetch-global-access.test.ts` (+78) with tests named
`uses a different cache key per accountability IP`,
`reuses the cache key for the same accountability IP`, and
`passes the accountability IP through to the per-role and per-user lookups`.

Value here: it is independent corroboration, three months later and in a second
cache, that Directus's cache-key derivation is a live regression surface with no
pre-existing guard. Weaker than D1/D2 on criterion 1, because the fix created the
test file rather than strengthening one, so there was no passing coverage before.

### Finding D4 — share update repointed a row to another owner

**Source-backed candidate. Covers class E (and B).**

- Advisory: [GHSA-7h45-q5jx-7r87](https://github.com/directus/directus/security/advisories/GHSA-7h45-q5jx-7r87),
  medium, published 2026-09-02, patched `12.3.1`.
- Fix commit: [`5869c06f6997af0d2f13b39b3d19297dd2ed2f65`](https://github.com/directus/directus/commit/5869c06f6997af0d2f13b39b3d19297dd2ed2f65)
  ("Prevent user created change on share updates", PR #28145, 2026-08-24),
  parent `2d9902964aacee0c7b352bf7104c3dca686c4d98`.

A non-admin who could update their own shares could reassign `user_created`,
`role`, `item` and `collection` afterwards. The update was authorized against the
row as it existed *before* the change and the merged row was never revalidated,
so the share's creator could be repointed to an administrator. The advisory notes
that the read-only marking on the creator field is a Data Studio UI hint that
does not constrain writes through the API — the brief's "permission rule that the
UI honours but the API does not", verbatim.

This is the closest Directus analogue to `archive_changes_other_owner`: an
update to a row the caller owns silently reassigns that row's owner.

**Why it ranks below D1/D2:** it fails criterion 1. The fix *created*
`api/src/services/shares.test.ts` (+101/-0, five named tests including
`rejects changing user_created before mutating` and
`fetches the missing side and validates each collection once`). There was no
pre-existing unit test for `SharesService.updateMany`, and a search of `tests/`
at the pinned revision finds no shares E2E or blackbox test at all. So the
feature had no coverage to pass blindly. The fix also changed
`packages/system-data/src/app-access-permissions/index.ts`, i.e. the shipped
default permission template.

### Also reviewed in Directus, not pursued

- [GHSA-xjxq-pj7h-g676](https://github.com/directus/directus/security/advisories/GHSA-xjxq-pj7h-g676)
  (high, 2026-08-05, patched `12.1.0`) — TUS upload replacement did not enforce
  item-level authorization on the targeted file, so one user could overwrite
  another user's stored object *and* its `directus_files` record, with the
  victim's `id` and `uploaded_by` preserved. Explicitly a variant of the earlier
  [GHSA-qqmv-5p3g-px89](https://github.com/directus/directus/security/advisories/GHSA-qqmv-5p3g-px89):
  that fix validated the `id` metadata key while the completion handlers acted on
  an adjacent `replace_id` key that was never validated. A repeated incomplete
  fix in a cross-owner write path, and `tests/e2e/tests/endpoints/files/` already
  contains `files.test.ts`, `filename-disk.test.ts` and `old.test.ts`. Strong
  class A/B/E shape; it needs `TUS_ENABLED=true` and a storage-backed capture,
  which is why it is listed rather than recommended. Worth a second pass.
- [GHSA-99vm-5v2h-h6r6](https://github.com/directus/directus/security/advisories/GHSA-99vm-5v2h-h6r6)
  (medium, 2025-02-19, patched `11.1.2`) — overlapping update policies allowed
  writing the *union* of permitted fields rather than the fields permitted for
  that specific item, "potentially impacting the password field for user
  accounts". Directly adjacent to the `read with fields with access to id,
  category` cases in `permissions.test.ts`.
- [GHSA-38hg-ww64-rrwc](https://github.com/directus/directus/security/advisories/GHSA-38hg-ww64-rrwc)
  (high) — concealed fields extractable via aggregate queries, against a
  pre-existing `tests/e2e/tests/endpoints/query/aggregate/aggregate.test.ts`.
  Same oracle shape as Twenty's T1 below.

---

## 2. Rocket.Chat — best single assertion gap, worst setup cost

Pin: [`d6956ab50f206a47d57c45c6e4d59041828ebcce`](https://github.com/RocketChat/Rocket.Chat/tree/d6956ab50f206a47d57c45c6e4d59041828ebcce)
(develop, 2026-09-12).

### Finding RC1 — cross-owner channel takeover via the unguarded lookup path

**Source-backed candidate. Covers class E (and A, B).**

- Advisory: [GHSA-4mvx-9h2h-hmg3](https://github.com/RocketChat/Rocket.Chat/security/advisories/GHSA-4mvx-9h2h-hmg3),
  medium, published 2026-07-11. Patched across eight release lines
  (`8.6.1`, `8.5.2`, `8.4.5`, `8.3.7`, `8.2.7`, `8.1.7`, `8.0.8`, `7.10.14`),
  which is itself evidence the defect shipped broadly and lived a long time.
- Fix commit: [`175a19c4151f41910499ef37df54f58022276d12`](https://github.com/RocketChat/Rocket.Chat/commit/175a19c4151f41910499ef37df54f58022276d12)
  ("fix: team conversion permissions checked incorrectly", PR #41206,
  2026-07-08). Parent: `355c8c0a186d258cefb028ac9e733cd8b082202b`.

The advisory: `channels.convertToTeam` let any authenticated user convert an
arbitrary public channel they had no relationship to into a team, by identifying
the channel with `channelName` instead of `channelId`. The endpoint's own default
permission (`create-team`) is granted to every registered user, and the one guard
meant to restrict this to the channel's owner/moderator/admin (`edit-room`) was
evaluated **only** when `channelId` was supplied.

**Pre-existing coverage that passed anyway.** At the fix's parent,
`apps/meteor/tests/end-to-end/api/channels.ts` already had a
`describe('/channels.convertToTeam')` block containing, among others:

- `should fail to convert channel if lacking create-team permission` — sends
  `{ channelId: testChannel._id }`, expects `403`.
- `should fail to convert channel if lacking edit-room permission` — sends
  `{ channelId: testChannel._id }`, expects `403`.
- `should successfully convert a channel to a team when the channel's name is
  sent as parameter` — sends `{ channelName: testChannel.name }` as the admin,
  against the admin's own channel, expects `200`.

So the suite covered both the permission guard *and* the `channelName` path, and
passed, because it only ever exercised `channelName` on the happy path with a
principal who was entitled. The two negative tests both used `channelId`, the one
lookup the guard actually covered.

**The specific assertions that were absent, named by the fix.** The commit adds
11 lines of application code (`apps/meteor/server/api/v1/channels.ts` +5/-5,
`apps/meteor/server/api/v1/teams.ts` +6/-1) and 87 lines of test:

- `apps/meteor/tests/end-to-end/api/channels.ts` (+30): a new describe,
  `when a user without edit-room permission on the channel tries to convert it
  to a team`, with `should return 403 when using channelName` — a separate
  outsider user against a channel they do not own.
- `apps/meteor/tests/end-to-end/api/teams.ts` (+57): `should not allow a user
  with no ownership/moderation of a room to hijack it into a new team by passing
  room.id`. This is the assertion Beyond Green exists to supply: after asserting
  the `403`, it **re-reads the target room** via `channels.info` and asserts
  `expect(res.body.channel).to.not.have.property('teamId')` and
  `.to.not.have.property('teamMain')`. A persisted-state post-condition on
  another owner's row after a denied request. Nothing of the kind existed before.

This is the single cleanest instance in this survey of the brief's pattern: the
fix strengthens the pre-existing E2E test for the same feature, and the added
assertion is specifically about persisted cross-owner state rather than about the
response.

**Setup cost, honestly.** `.github/workflows/ci-test-e2e.yml` needs
`MONGO_URL=mongodb://localhost:27017/rocketchat?replicaSet=rs0&directConnection=true`
— a Mongo replica set, not a standalone `mongod`. CI shards across MongoDB
versions, pulls prebuilt Docker images from GitHub Container Registry using
`secrets.CR_USER`, sets kernel limits, and starts CE and EE container sets plus an
`httpbin` sidecar. Reproducing locally means a Meteor build
(`.github/actions/meteor-build`) plus Docker. Expect well over an hour on a first
run, and treat the 30-minute target as not achievable here. No Kubernetes is
involved, so the hard constraint holds, but this is the highest-risk candidate on
the list.

---

## 3. Twenty — deeper pass on the reserved candidate

Pin: [`b782836bca6841bf735026d2223bbb22a65019a6`](https://github.com/twentyhq/twenty/tree/b782836bca6841bf735026d2223bbb22a65019a6)
(main, 2026-09-12). This happens to be the same revision already pinned in
[benchmark-products.md](benchmark-products.md).

**Prior art, acknowledged and not adopted.** Twenty's
`.github/workflows/ci-e2e-main.yaml` contains a QA Scout stage that runs after
the deterministic tests: an agent that derives scenarios from a merged PR, drives
the browser, and inspects server and worker logs. That is adjacent prior art to
Beyond Green and must be cited as such. Nothing from it — no agent code, no
prompt, no investigation loop, no evidence-collection implementation — is to be
read into or copied into this project. Twenty is a benchmark *dependency* only.

Beyond the timeline-activity mutation already proposed in benchmark-products.md,
this pass found two genuine historical leakage bugs plus one supporting issue.

### Finding T1 — field read permission enforced on output but not on filters

**Source-backed candidate. Covers class C.**

- Advisory: [GHSA-v93q-4jcx-7p9m](https://github.com/twentyhq/twenty/security/advisories/GHSA-v93q-4jcx-7p9m),
  medium, published 2026-09-02, vulnerable `< 2.22.0`, patched `2.22.0`.
- Fix commit: [`a5108d512f754a937860bda5e0c2c40c7266e19e`](https://github.com/twentyhq/twenty/commit/a5108d512f754a937860bda5e0c2c40c7266e19e)
  ("Block filters on restricted fields", PR #22873, 2026-07-16).
  Parent: `988f8ff900692c160590a8c32644af87e0770dbb`.

Field-level read permission was enforced only on the output/SELECT path, not on
the filter predicate. A member whose role could read an object but was denied a
specific field could still reference that field in a filter, and because row
presence and `totalCount` depend on the filter, the response acted as a
boolean/count oracle over the denied value, on both GraphQL and REST. The
advisory notes the remediation mirrors "the existing `orderBy` guard" — that is,
one sibling path was already guarded and the filter path was not.

This is a class C finding in the plan's sense: two views of the same system
disagree. The denied field is absent from the response body while the record
count in the same response depends on its value.

**Pre-existing coverage that passed anyway.** The fix adds 32 lines to
`packages/twenty-server/test/integration/graphql/suites/object-records-permissions/fields-permissions/read-permissions.integration-spec.ts`,
which has existed since
[`ae6adb3a63f887f556b619531ee2b549e0537055`](https://github.com/twentyhq/twenty/commit/ae6adb3a63f887f556b619531ee2b549e0537055)
("[permissions] Add read field permission check layer (part 1)", PR #13376,
2025-07-23). The application change is 35 lines across
`common-group-by-query-runner.service.ts` (+15/-7) and
`graphql-query-filter-field.parser.ts` (+20/-0). The commit message states the
gap plainly: "a user who cannot read a field can still infer its values from
totalCount", and "Add unit and integration coverage for denied field filter
access".

**The specific assertion that was absent:** the spec asserted that a denied field
is stripped from the response, and never asserted that a query *filtering* on a
denied field is rejected. The pre-existing test suite was constructed entirely
around the output path.

**Corroboration that the gap recurs.** The same spec was strengthened a second
time seven weeks later, in
[`ea0f7e1fdfba8912c29c466918297c4261a96c43`](https://github.com/twentyhq/twenty/commit/ea0f7e1fdfba8912c29c466918297c4261a96c43)
("test(server): cover field read permission for group-by records selection",
PR #25206, 2026-09-02) — which is the same date the advisory was published. Two
successive strengthenings of one pre-existing permission spec is a strong signal
that this feature's assertion surface is systematically behind its code.

### Finding T2 — cross-workspace IDOR writing into the victim's tenant

**Source-backed candidate. Covers class E (and B).**

- Advisory: [GHSA-v39r-w5vg-j9pp](https://github.com/twentyhq/twenty/security/advisories/GHSA-v39r-w5vg-j9pp),
  high, published 2026-06-17, vulnerable `< 2.9.0`.

This is the closest real-world twin of `archive_changes_other_owner` found in the
whole survey, and it is a **write**, not a read. Per the advisory, two operations
in `packages/twenty-server/src/engine/metadata-modules/ai/ai-agent-monitor/resolvers/agent-turn.resolver.ts`
looked rows up by `agentId` / `id` only. `AgentTurnEntity` has a `workspaceId`
column that was not in the `WHERE` clause, and the class-level guards only checked
that the caller was authenticated in *some* workspace. The read side returned
another workspace's chat history. The write side inserted a row into
`core."agentTurnEvaluation"` **carrying the victim's `workspaceId`** — one
tenant's action creating persisted state inside another tenant — and additionally
fed the victim's data into the default LLM in an attacker-initiated call. The
advisory itself notes the identifiers are UUIDs that are not guessable and appear
in settings-page URLs, so the practical precondition is possession of those
identifiers.

A missing tenant predicate in a `WHERE` clause causing a write to land in another
tenant's rows is exactly the brief's first hunt target, and exactly the case the
cheap model declined to conclude on in the Linkding study.

**Why it does not lead the shortlist.** It fails criterion 1. At the pinned
revision there is no test file for that resolver or for
`agent-turn-grader.service.ts`; a tree search for `agent`-related `spec` files
returns unit specs for chat streaming, message-part mapping and role-permission
config, but nothing covering `agentTurns` or `evaluateAgentTurn`. So the feature
had no coverage that passed blindly — the coverage simply did not exist. I also
did not pin the remediation commit: the resolver's history around the advisory
window contains `4797d2f270f15d4bca544154836112894e02a8f6`
(`WorkspaceScopedRepository` introduction, 2026-05-27) and
`585e87405eec7f4f927b1237690c51f5a75673dc` (scoped-repository `save()` refactor,
2026-08-18), and which of these constitutes the fix was not established.

Use T2 as the *design template* for a mutation (drop a tenant predicate from a
scoped repository query, then observe the write land in the wrong workspace) while
citing T1 as the finding with real held-out coverage.

### Supporting: cross-user leakage through workspace-wide metadata broadcast

[Issue #20483](https://github.com/twentyhq/twenty/issues/20483), closed
2026-08-03: user-scoped `navigationMenuItem` rows leaked into other members'
Favorites and sidebar. The report's own analysis is that the server read and
mutation model is correct — `NavigationMenuItemService.findAll` returns only the
caller's `userWorkspaceId` rows — but `MetadataEventPublisher.publish` broadcasts
`navigationMenuItem` metadata events workspace-wide, `MetadataStoreSSEEffect`
applies them into every client store, and `useNavigationMenuItemsData` treats any
item with a defined `userWorkspaceId` as the current user's. The report notes that
[#19832](https://github.com/twentyhq/twenty/pull/19832) fixed the same class of
cross-user metadata contamination for `agentChatThread` by adding
`recipientUserWorkspaceIds`, and that the fix was not applied here.

Class E, and a recurring-pattern signal. Ranked last because the persisted state
is correct and the leak is in what a client renders — closer to the "visual
glitch" the brief deprioritises, and hard to capture as database evidence.

---

## 4. Strapi — cheapest setup, class C only

Pin: [`34fdea8fb4e11afc475a0ffdc14311cce09ddded`](https://github.com/strapi/strapi/tree/34fdea8fb4e11afc475a0ffdc14311cce09ddded)
(develop, 2026-09-11).

Strapi is the most affordable candidate here and the only one whose integration
job needs no service containers. `.github/workflows/tests.yml` at the pinned
revision defines `api_ce_sqlite` and `api_ee_sqlite` (API integration on SQLite
via `better-sqlite3`, sharded, no `services:` block), alongside Postgres and
MySQL variants, plus `e2e_ce`, `e2e_ee`, `e2e_media_library` and
`e2e_media_library_legacy` Playwright jobs. `node tests/scripts/run-api-tests.js`
defaults to the `sqlite` client. Node 20-26, yarn 4.12.0.

### Finding S1 — private-field filtering leak, fixed three times

**Source-backed candidate. Covers class C.**

The same defect class was patched in 2023, re-patched eleven weeks later, and
resurfaced in a different traversal in 2026:

1. [GHSA-jjqf-j4w7-92w8](https://github.com/strapi/strapi/security/advisories/GHSA-jjqf-j4w7-92w8)
   — critical, 2023-04-18, `>=3.2.1, <4.8.0`, patched `>=4.8.0`. Unauthenticated
   callers could filter users by columns holding sensitive values and infer them
   from response changes.
2. [GHSA-9xg4-3qfm-9w8f](https://github.com/strapi/strapi/security/advisories/GHSA-9xg4-3qfm-9w8f)
   — high, 2023-07-25, `<= 4.10.7`, patched `>= 4.10.8`. Titled "still possible
   by filtering on private **with prefix** fields": the first fix blocked the
   bare column name while the Knex table-alias-prefixed form went straight
   through.
3. [GHSA-rjg2-95x7-8qmx](https://github.com/strapi/strapi/security/advisories/GHSA-rjg2-95x7-8qmx)
   / CVE-2026-27886 — critical (CVSS 9.3), 2026-05-13, `<= 5.36.1`, patched
   `>= 5.37.0`. Query-parameter sanitization did not block operator chains that
   traversed *into relational target schemas* the caller had no read permission
   on. The remediation introduces three new primitives, `strictParam`,
   `addQueryParams` and `addBodyParams`, at the controller and service boundary.

**Pre-existing coverage that passed anyway.** The repository has a dedicated
pre-existing integration test for exactly this feature:
`tests/api/core/strapi/validation/private-params.test.api.js`. Its most recent
commit at the pinned revision is
[`cf82c830d8a75c9f35466f4c6010fb588d34063f`](https://github.com/strapi/strapi/commit/cf82c830d8a75c9f35466f4c6010fb588d34063f)
("test: restructure test dirs", 2024-04-02) — a directory move. The 2026
remediation therefore did **not** strengthen it: the test that exists precisely
to assert "you cannot filter on private params" passed through a critical
unauthenticated leak of the same kind. Siblings in the same position include
`tests/api/core/strapi/deep-filtering.test.api.js` (last functional change
[`5285f8db425cb2e2f783e9469712395015871ce4`](https://github.com/strapi/strapi/commit/5285f8db425cb2e2f783e9469712395015871ce4),
2024-06-20) and `tests/api/core/strapi/api/validate/validate-query.test.api.js`.

**The specific assertion that was absent:** the private-params test asserts that
directly named private attributes are rejected as filter keys. It does not assert
anything about filter keys reached through a relation traversal into a joined
table whose schema the caller cannot read, nor about alias-prefixed column forms.
Each incomplete fix left the next spelling of the same operation unasserted.

**Unverified / honest gap.** I did not pin the exact commit that shipped in
5.37.0 for CVE-2026-27886. The advisory carries no commit references, and the
`strictParam` primitives land earlier, in
[`79a590a581fd8272fafe5644b39c108a3a192b67`](https://github.com/strapi/strapi/commit/79a590a581fd8272fafe5644b39c108a3a192b67)
("security(feat): add strictParam, addQueryParams, addBodyParams", PR #25528,
2026-02-24), which touched the pre-existing unit tests
`packages/core/utils/src/__tests__/validate-query.test.ts` and
`packages/core/utils/src/__tests__/sanitize-input.test.ts`. Whether the release
fix was a separate squashed commit on a release branch is not established. Pin it
before using S1 as a benchmark citation.

Strapi's limitation for our purpose: its strongest gaps in this domain are
read-only inference leaks. They add class C but not class E, and they produce no
persisted cross-owner state for a database snapshot to catch. Other Strapi
advisories reviewed and not pursued: `GHSA-495j-h493-42q2` (private fields via
`parms.lookup`), `GHSA-gc7p-j5xm-xxh2` (private fields in the registration API),
`GHSA-m284-85mf-cgrc` (field-level permissions ignored in relationship titles),
`GHSA-chmr-rg2f-9jmf` (a 2023 content-type extension footgun, not a tenant issue).

---

## 5. NocoDB — disqualified on the existing-suite gate

Pin: [`588d51381ec28a8e4811450cd7155ccd51bba8c6`](https://github.com/nocodb/nocodb/tree/588d51381ec28a8e4811450cd7155ccd51bba8c6)
(develop, 2026-09-12).

NocoDB has the richest cross-tenant advisory stream of any project surveyed — 48
published advisories, several squarely on target:

- [GHSA-96fh-m4r8-6v9v](https://github.com/nocodb/nocodb/security/advisories/GHSA-96fh-m4r8-6v9v)
  (medium, 2026-06-04, patched `2026.05.1`) — a user in one workspace could
  exercise **another workspace's** integration through `testConnection`, because
  the integration was fetched in `RootScopes.BYPASS` and the permission check
  matched any base in any workspace. Textbook missing tenant filter.
- [GHSA-f76x-f9vj-92jv](https://github.com/nocodb/nocodb/security/advisories/GHSA-f76x-f9vj-92jv)
  (medium, 2026-05-19, patched `2026.04.4`) — deleted API tokens kept
  authenticating for up to three days because the auth cache was not evicted by
  token value on deletion. Textbook shared-cache staleness, class C + E.
- [GHSA-4w6r-5c2j-qf5f](https://github.com/nocodb/nocodb/security/advisories/GHSA-4w6r-5c2j-qf5f)
  (high, 2026-06-04, patched `2026.04.1`) — public shared views exposed
  owner-hidden columns through three independent paths, including
  boolean-blind extraction via filter and sort.
- [GHSA-xxpj-q764-9r6q](https://github.com/nocodb/nocodb/security/advisories/GHSA-xxpj-q764-9r6q)
  (low) — missing ownership check on MCP attachment read, reaching attachments of
  other bases and workspaces.
- [GHSA-chqv-vrj7-qffp](https://github.com/nocodb/nocodb/security/advisories/GHSA-chqv-vrj7-qffp)
  (medium) — member invite reachable via a shared-base link.

**Why it is nevertheless out.** At this revision the repository has no `tests`
directory at all — the root tree contains `packages`, `charts`, `docker-compose`,
`markdown`, `scripts` and nothing else. A GitHub code search for `playwright` in
paths within `nocodb/nocodb` returns **0** results. The only test-bearing CI
workflows are `jest-unit-test.yml` (NestJS unit tests under
`packages/nocodb`, `pnpm bootstrap` + SDK build, no browser) and `ci-cd.yml`
(Swagger JSON validation). The Playwright suite that NocoDB historically shipped
in `tests/playwright` is not present in the OSS repository at this revision.

This is a negative finding about the inspected public tree at one pinned
revision, not a claim that NocoDB has no tests anywhere. But it means there is no
pre-existing browser or API suite to run unchanged, which is the selection gate.
Do not spend hackathon time writing one.

---

## 6. Appwrite and Supabase — thin in this pass

**Appwrite**, pin [`a410fc2ba96529481416dd633d62f0082a4dbfdd`](https://github.com/appwrite/appwrite/tree/a410fc2ba96529481416dd633d62f0082a4dbfdd)
(main, 2026-09-12). `/repos/appwrite/appwrite/security-advisories` returns an
empty list: the project does not publish repository advisories. The Advisory
Database rows affecting `appwrite/server-ce` are `GHSA-wfm3-gq9h-mrjm` (directory
traversal), `GHSA-hxgx-584x-vwm8` (SSRF), `GHSA-5ffj-mph5-c5hv` (XSS) and
`GHSA-v9p9-535w-4285` (prototype pollution in a bundled dependency). None is a
cross-tenant or permission-boundary defect with an identifiable pre-existing
passing test. The repo does have `tests/e2e` (PHPUnit HTTP tests) alongside
`tests/unit`, `tests/benchmarks` and `tests/extensions`, so the suite gate could
be met; the *gap* gate was not. De-prioritised, not disqualified — a deeper pass
through Appwrite's closed bug issues (team/permission scoping on documents) may
still turn something up.

**Supabase**, not pinned. `/repos/supabase/supabase/security-advisories` returns
an empty list. The multi-tenant leakage surface for Supabase lives in satellite
repositories rather than the main monorepo — the auth service, Realtime, and the
Supavisor connection pooler, the last of which is the natural home of the brief's
"shared connection leaking data between tenants". Those are Elixir and Go
services with their own language test suites rather than an application with a
browser or HTTP E2E suite and a snapshot-able application database, so they are a
poor structural fit for a Beyond Green capture even where the bug history is
good. **I did not investigate them.** See "Not verified" below.

---

## Regression-class coverage this would add

| Finding | App | A | B | C | D | E |
|---|---|:-:|:-:|:-:|:-:|:-:|
| D1 side effects before permission check | Directus | yes | yes | yes | - | **yes** |
| D2 unsegmented response-cache key | Directus | - | - | **yes** | - | **yes** |
| D3 global-access cache ignored client IP | Directus | - | - | **yes** | - | **yes** |
| D4 share update repoints owner | Directus | - | yes | - | - | **yes** |
| RC1 cross-owner channel takeover | Rocket.Chat | yes | yes | - | - | **yes** |
| T1 filter-predicate field oracle | Twenty | - | - | **yes** | - | - |
| T2 cross-workspace IDOR write | Twenty | - | yes | - | - | **yes** |
| T3 metadata broadcast to other users | Twenty | - | - | - | - | **yes** |
| S1 private-field filtering leak | Strapi | - | - | **yes** | - | - |

Classes C and E are currently uncovered by the Linkding benchmark. D1, D2, D3 and
RC1 each cover at least one of them; D2 and D3 cover both.

Note that class D (background failure) is still not covered by anything in this
survey. Twenty's asynchronous audit-loss mutation in
[benchmark-products.md](benchmark-products.md) remains the candidate for that.

---

## Suggested sequence

1. **Directus D1.** Real multi-identity E2E test already exists and asserts only
   the rejection; the historical fix added no assertion, so the gap is genuinely
   held out upstream. Highest information per hour, and it produces persisted
   state plus an HTTP/database contradiction in one case.
2. **Directus D2/D3** as a second Directus case if the sandbox proves workable,
   accepting that staging them needs a two-identity capture that no upstream test
   currently performs.
3. **Strapi S1** if a cheap second product is wanted for class C, after pinning
   the 5.37.0 commit.
4. **Rocket.Chat RC1** only if the Mongo replica set and Meteor build are already
   available. Its gap is the best in the survey; its cost is the worst.
5. **Twenty** stays reserved, now with T1 as a documented held-out gap and T2 as
   a mutation template.

---

## Not verified

Read this section before citing anything above.

**Nothing was executed.** No application from this document was installed,
built, seeded, or run. No test was executed. No baseline and no mutant was
captured. No leak, side effect, or cross-tenant write was observed. Every
statement about runtime behaviour is a reading of pinned source, a pinned commit
diff, or a published advisory, and is therefore an inference about behaviour, not
an observation of it. **No gap in this document is reproduced.**

Specifically not established:

1. **That any candidate's suite runs on this machine.** Setup costs are derived
   from CI workflow files and readmes, not from measurement. No install, build,
   container start, or test run was attempted. The Docker daemon's state was not
   checked for this document. The "20-45 min" and ">1 hour" figures are
   estimates.
2. **That an unchanged upstream test stays green under a faithful mutation.** For
   every finding, the pairing of a specific upstream test with a specific
   reversible mutation is a proposal. The acceptance gate in
   [benchmark-selection.md](benchmark-selection.md) still applies in full: pin,
   run the unchanged test clean, collect evidence, mutate, rerun, and accept only
   when the test still passes and independent evidence shows the defect.
3. **D1's reachability.** `permissions.test.ts` drives a custom collection
   through the generic `ItemsService`, while the historical defect lived in the
   `directus_flows` / `directus_users` / `directus_shares` subclasses. Which
   upstream test can exercise a reintroduced ordering defect, in which suite, is
   unresolved.
4. **D2's stageability.** Response caching is off in the Directus e2e sandbox
   (`cache: false`, no `CACHE_ENABLED`), and the upstream blackbox cache test
   drives a single admin identity. A capture demonstrating cross-identity cache
   leakage would need two identities reading one URL, which no current upstream
   test does.
5. **Whether Directus's `tests/e2e` sqlite project can run without Docker.** The
   readme requires Docker and `global-setup-one.ts` requests `maildev`, `redis`,
   `saml`, `minio` and `license` extras for every project. I did not read
   `@directus/sandbox` to determine whether the sqlite path skips containers.
6. **Strapi's 5.37.0 remediation commit** for CVE-2026-27886. Not pinned. The
   `strictParam` primitives commit is pinned; the release fix is not.
7. **Twenty's remediation commit** for GHSA-v39r-w5vg-j9pp (T2). Not pinned. Two
   plausible commits are named; neither is confirmed as the fix.
8. **Whether `api/src/services/flows.test.ts` existed at D1's parent.** Its last
   recorded change is 2023-04-04 and the file is absent from `main` at the pinned
   revision; a fetch at the fix's parent returned 404. So the claim "the fix
   added no ordering assertion" rests on the commit's own file list, not on a
   comparison against a surviving flows unit test.
9. **Test counts and pass rates.** No number in this document is a measured
   count of passing tests. Test names and file contents were read from pinned
   blobs; whether those tests currently pass on any machine was not checked.
10. **Licensing.** Directus, Rocket.Chat, Twenty, Strapi, NocoDB and Appwrite
    each ship licence terms that were not read for this document beyond Twenty's
    previously recorded AGPL-3.0 declaration. Confirm each before publishing a
    benchmark that redistributes or depends on them.
11. **Supabase.** Not investigated. Listed only to record that the main monorepo
    publishes no repository advisories and that the relevant surface is in
    satellite services which look structurally unsuitable. That judgement is
    based on general knowledge of those repositories, not on inspection at a
    pinned revision.
12. **Appwrite's closed-issue history.** Only advisories were reviewed. A pass
    through Appwrite's closed bug issues for team/permission scoping defects has
    not been done.

Two further constraints on any use of this material. Twenty ships a QA Scout
agent stage in its own CI; it is adjacent prior art to Beyond Green, must be
cited as such, and none of its implementation may be adopted as
hackathon-created code. And Directus ships an `AGENTS.md`, a `.claude`
directory, an `ai_policy.md` and a `claude.yml` workflow at the pinned revision;
treat those the same way — upstream context to acknowledge, never to import.
