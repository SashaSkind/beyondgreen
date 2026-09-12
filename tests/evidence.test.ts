import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { loadLinkdingEvidence } from "../src/investigation/evidence.ts";

const SENTINEL = "FORBIDDEN_MUTATION_LABEL_AND_LOCAL_PATH";
const SELECTED_TEST = "bookmarks/tests_e2e/e2e_test_bookmark_page_partial_updates.py::BookmarkPagePartialUpdatesE2ETestCase::test_active_bookmarks_partial_update_on_archive";
const bookmark = {
  id: 1, owner_id: 1, title: "Example", url: "https://example.com", is_archived: false,
  unread: false, shared: false, date_added: "2026-09-12", date_modified: "2026-09-12",
  ignored_label: SENTINEL,
};
const snapshot = (archived: boolean) => ({
  bookmarks: [{ ...bookmark, is_archived: archived }],
  tags: [{ id: 1, owner_id: 1, name: "Example tag", ignored_label: SENTINEL }],
  bookmark_tags: [{ bookmark_id: 1, tag_id: 1, ignored_label: SENTINEL }],
  kind: SENTINEL,
});
const event = (source: string, name: string, metadata: object) => ({
  source, event: name, metadata: { ...metadata, ignored_label: SENTINEL },
  id: SENTINEL, timestamp: SENTINEL,
});
const evidence = () => ({
  schema_version: 1, pytest_exit_status: 0, collection_errors: [],
  test_reports: ["setup", "call", "teardown"].map((phase) => ({
    node_id: SELECTED_TEST, phase, outcome: "passed", ignored_label: SENTINEL,
  })),
  events: [
    event("database", "snapshot", { phase: "before", bookmark_count: 1 }),
    event("http", "request", { request_id: "r1", method: "POST", path: "/bookmarks/action", origin: SENTINEL, form: { archive: ["1"] } }),
    event("http", "response", { request_id: "r1", status: 200, content_type: SENTINEL }),
    event("application_log", "message", { message: SENTINEL }),
    event("database", "snapshot", { phase: "after", bookmark_count: 1 }),
  ],
  runtime: { ignored_label: SENTINEL }, command: SENTINEL, kind: SENTINEL,
});

async function writeJson(directory: string, name: string, value: unknown) {
  await writeFile(join(directory, name), JSON.stringify(value));
}

async function fixtures(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), `${SENTINEL}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  const current = join(root, "current");
  const baseline = join(root, "baseline");
  for (const dir of [current, baseline]) {
    await mkdir(dir);
    await writeJson(dir, "evidence.json", evidence());
    await writeJson(dir, "database-before.json", snapshot(false));
    await writeJson(dir, "database-after.json", snapshot(true));
    // Intentionally invalid JSON: parsing any experiment metadata would fail.
    for (const name of ["run.json", "comparison.json", "mutation.patch"]) {
      await writeFile(join(dir, name), SENTINEL);
    }
  }
  return { current, baseline };
}

test("projects only observed facts and whitelisted snapshots, never experiment labels or paths", async (t) => {
  const { current, baseline } = await fixtures(t);
  const source = await loadLinkdingEvidence(current, baseline);
  assert.deepEqual(source.initial, {
    test: { passed: true, scenario: "Archive an active bookmark" },
    operation: { method: "POST", path: "/bookmarks/action", targetId: 1, status: 200 },
    counts: { before: 1, after: 1 },
  });
  const database = await source.retrieve("database_state");
  const contract = await source.retrieve("operation_contract");
  const knownGood = await source.retrieve("known_good_run");
  const all = JSON.stringify({ initial: source.initial, catalog: source.catalog, database, contract, knownGood });
  assert.ok(!all.includes(SENTINEL));
  assert.ok(!all.includes("regression"));
  assert.ok(all.includes("eb98e67d942436b8ad0207dae5fd99a268463a0b"));
  assert.ok(all.includes("Example tag"));
  assert.deepEqual((database as any).before.bookmarks[0].is_archived, false);
  assert.deepEqual((database as any).after.bookmarks[0].is_archived, true);
});

test("preserves actual empty after-state without adding a verdict", async (t) => {
  const { current, baseline } = await fixtures(t);
  const input = evidence();
  (input.events[4].metadata as any).bookmark_count = 0;
  await writeJson(current, "evidence.json", input);
  await writeJson(current, "database-after.json", { bookmarks: [], tags: snapshot(false).tags, bookmark_tags: [] });
  const source = await loadLinkdingEvidence(current, baseline);
  const state = await source.retrieve("database_state") as any;
  assert.equal(state.targetId, 1);
  assert.equal(state.before.bookmarks.length, 1);
  assert.equal(state.after.bookmarks.length, 0);
  assert.equal(state.verdict, undefined);
});

test("missing and corrupt databases fail when retrieved, without fabricated snapshots or path leaks", async (t) => {
  const { current, baseline } = await fixtures(t);
  await rm(join(current, "database-after.json"));
  const source = await loadLinkdingEvidence(current, baseline);
  await assert.rejects(source.retrieve("database_state"), (error: Error) => {
    assert.ok(!error.message.includes(SENTINEL));
    return /database-after.json/.test(error.message);
  });
  await writeFile(join(current, "database-after.json"), "{broken");
  await assert.rejects(source.retrieve("database_state"), /database-after.json/);
  await writeJson(current, "database-after.json", { bookmarks: [] });
  await assert.rejects(source.retrieve("database_state"), /expected an array/);
  await rm(join(baseline, "database-before.json"));
  await assert.rejects(source.retrieve("known_good_run"), /database-before.json/);
});

test("rejects wrong tests, failed phases, duplicate phases and collector failures", async (t) => {
  const { current, baseline } = await fixtures(t);
  const mutations = [
    (data: any) => { data.schema_version = 2; },
    (data: any) => { data.pytest_exit_status = 1; },
    (data: any) => { data.collection_errors = [{ message: SENTINEL }]; },
    (data: any) => { data.test_reports[1].node_id = "another-test"; },
    (data: any) => { data.test_reports[1].outcome = "failed"; },
    (data: any) => { data.test_reports[2].phase = "setup"; },
    (data: any) => { data.test_reports.push(data.test_reports[1]); },
  ];
  for (const mutate of mutations) {
    const input = evidence();
    mutate(input);
    await writeJson(current, "evidence.json", input);
    await assert.rejects(loadLinkdingEvidence(current, baseline), /Invalid Linkding evidence/);
  }
});

test("requires an unambiguous observed archive POST with its own successful response", async (t) => {
  const { current, baseline } = await fixtures(t);
  const mutations = [
    (data: any) => { data.events[2].metadata.request_id = "unrelated"; },
    (data: any) => { data.events[2].metadata.status = 500; },
    (data: any) => { data.events[1].metadata.method = "GET"; },
    (data: any) => { data.events[1].metadata.path = `/${SENTINEL}`; },
    (data: any) => { data.events[1].metadata.form.archive = ["1", "2"]; },
    (data: any) => { data.events[1].metadata.form.remove = ["1"]; },
    (data: any) => { data.events.push(data.events[1]); },
    (data: any) => { data.events.push(data.events[2]); },
    (data: any) => { [data.events[1], data.events[2]] = [data.events[2], data.events[1]]; },
  ];
  for (const mutate of mutations) {
    const input = evidence();
    mutate(input);
    await writeJson(current, "evidence.json", input);
    await assert.rejects(loadLinkdingEvidence(current, baseline), /Invalid Linkding evidence/);
  }
});

test("validates snapshot fields and observed counts and revalidates baseline evidence", async (t) => {
  const { current, baseline } = await fixtures(t);
  const source = await loadLinkdingEvidence(current, baseline);
  const invalid = snapshot(true);
  (invalid.bookmarks[0] as any).is_archived = "true";
  await writeJson(current, "database-after.json", invalid);
  await assert.rejects(source.retrieve("database_state"), /expected a boolean/);
  await writeJson(current, "database-after.json", { ...snapshot(true), bookmarks: [] });
  await assert.rejects(source.retrieve("database_state"), /count disagrees/);
  const baselineEvidence = JSON.parse(await readFile(join(baseline, "evidence.json"), "utf8"));
  baselineEvidence.pytest_exit_status = 1;
  await writeJson(baseline, "evidence.json", baselineEvidence);
  await assert.rejects(source.retrieve("known_good_run"), /pytest did not succeed/);
});

test("a green deletion mutant is inspectable as current evidence but rejected as known-good", async (t) => {
  const { current, baseline } = await fixtures(t);
  const input = evidence();
  (input.events[4].metadata as any).bookmark_count = 0;
  await writeJson(current, "evidence.json", input);
  await writeJson(current, "database-after.json", { bookmarks: [], tags: snapshot(false).tags, bookmark_tags: [] });
  const source = await loadLinkdingEvidence(current, baseline);
  assert.equal((await source.retrieve("database_state") as any).after.bookmarks.length, 0);
  await source.retrieve("known_good_run");
  const mislabeled = await loadLinkdingEvidence(baseline, current);
  await assert.rejects(mislabeled.retrieve("known_good_run"), /known-good run must retain and archive/);
});

test("known-good reference preserves all other fields, rows, tags and associations", async (t) => {
  const { current, baseline } = await fixtures(t);
  const before = snapshot(false);
  before.bookmarks.push({ ...bookmark, id: 2 });
  const after = structuredClone(before);
  after.bookmarks[0].is_archived = true;
  after.bookmarks[0].date_modified = "2026-09-13";
  const input = evidence();
  (input.events[0].metadata as any).bookmark_count = 2;
  (input.events[4].metadata as any).bookmark_count = 2;
  await writeJson(baseline, "evidence.json", input);
  await writeJson(baseline, "database-before.json", before);
  await writeJson(baseline, "database-after.json", after);
  const source = await loadLinkdingEvidence(current, baseline);
  // A changed target timestamp is permitted, with no requirement of byte identity.
  await source.retrieve("known_good_run");
  const mutations = [
    (data: typeof after) => { data.bookmarks[0].is_archived = false; },
    (data: typeof after) => { data.bookmarks[0].title = "Unexpected title"; },
    (data: typeof after) => { data.bookmarks[1].date_modified = "Unexpected change"; },
    (data: typeof after) => { data.bookmarks[1].id = 3; },
    (data: typeof after) => { data.tags[0].name = "Unexpected tag"; },
    (data: typeof after) => { data.bookmark_tags = []; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(after);
    mutate(invalid);
    await writeJson(baseline, "database-after.json", invalid);
    await assert.rejects(source.retrieve("known_good_run"), /known-good run/);
  }
});
