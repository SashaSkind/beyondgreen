import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { EvidenceSource, Json } from "./types.ts";

const SELECTED_TEST = "bookmarks/tests_e2e/e2e_test_bookmark_page_partial_updates.py::BookmarkPagePartialUpdatesE2ETestCase::test_active_bookmarks_partial_update_on_archive";
const SOURCE = "https://github.com/sissbruecker/linkding/blob/eb98e67d942436b8ad0207dae5fd99a268463a0b/bookmarks/services/bookmarks.py#L87-L91";
type ObjectValue = Record<string, unknown>;
type Operation = { method: string; path: string; targetId: number; status: number };
type Summary = { operation: Operation; counts: { before: number; after: number } };

function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid Linkding evidence: ${message}`);
}

function object(value: unknown): ObjectValue {
  requireValid(value !== null && typeof value === "object" && !Array.isArray(value), "expected an object");
  return value as ObjectValue;
}

function array(value: unknown): unknown[] {
  requireValid(Array.isArray(value), "expected an array");
  return value;
}

function integer(value: unknown, minimum = 0): number {
  requireValid(typeof value === "number" && Number.isSafeInteger(value) && value >= minimum, "invalid integer");
  return value;
}

function string(value: unknown): string {
  requireValid(typeof value === "string", "expected a string");
  return value;
}

function boolean(value: unknown): boolean {
  requireValid(typeof value === "boolean", "expected a boolean");
  return value;
}

// Read only these three collector files. Errors deliberately omit local paths and raw JSON.
async function readArtifact(directory: string, name: "evidence.json" | "database-before.json" | "database-after.json"): Promise<ObjectValue> {
  try {
    const path = join(directory, name);
    requireValid((await stat(path)).size <= 8 * 1024 * 1024, "artifact exceeds size limit");
    return object(JSON.parse(await readFile(path, "utf8")));
  } catch {
    throw new Error(`Unable to read valid Linkding ${name}`);
  }
}

async function readSummary(directory: string): Promise<Summary> {
  const data = await readArtifact(directory, "evidence.json");
  requireValid(data.schema_version === 1, "unsupported schema version");
  requireValid(data.pytest_exit_status === 0, "pytest did not succeed");
  requireValid(array(data.collection_errors).length === 0, "collector reported errors");
  const reports = array(data.test_reports).map(object);
  requireValid(reports.length === 3 && new Set(reports.map((report) => report.phase)).size === 3 &&
    reports.every((report) => report.node_id === SELECTED_TEST && report.outcome === "passed" &&
      ["setup", "call", "teardown"].includes(string(report.phase))), "expected exactly the selected passing test and its setup/teardown");

  const events = array(data.events).map((value) => {
    const event = object(value);
    return { source: string(event.source), event: string(event.event), metadata: object(event.metadata) };
  });
  const requests = events.filter((event) => event.source === "http" && event.event === "request");
  const archiveRequests = requests.filter((event) => Object.hasOwn(object(event.metadata.form), "archive"));
  requireValid(archiveRequests.length === 1, "expected one archive request");
  const requestEvent = archiveRequests[0];
  const request = requestEvent.metadata;
  const requestId = string(request.request_id);
  requireValid(requestId.length > 0 && requests.filter((event) => event.metadata.request_id === requestId).length === 1, "ambiguous archive request identity");
  requireValid(request.method === "POST" && request.path === "/bookmarks/action", "unexpected archive operation");
  const form = object(request.form);
  requireValid(!Object.hasOwn(form, "remove") && !Object.hasOwn(form, "unarchive"), "ambiguous archive action");
  const targets = array(form.archive);
  requireValid(targets.length === 1 && /^[1-9]\d*$/.test(string(targets[0])), "invalid archive target");
  const targetId = integer(Number(targets[0]), 1);
  const responses = events.filter((event) => event.source === "http" && event.event === "response" && event.metadata.request_id === requestId);
  requireValid(responses.length === 1 && responses[0].metadata.status === 200 && events.indexOf(responses[0]) > events.indexOf(requestEvent), "archive request lacks a matching HTTP 200 response");
  requireValid(!events.some((event) => event.source === "http" && event.event === "request_failed" && event.metadata.request_id === requestId), "archive request failed");

  function count(phase: string): number {
    const snapshots = events.filter((event) => event.source === "database" && event.event === "snapshot" && event.metadata.phase === phase);
    requireValid(snapshots.length === 1, "expected one snapshot per phase");
    return integer(snapshots[0].metadata.bookmark_count);
  }
  return {
    operation: { method: "POST", path: "/bookmarks/action", targetId, status: 200 },
    counts: { before: count("before"), after: count("after") },
  };
}

async function readSnapshot(directory: string, phase: "before" | "after", expectedCount: number) {
  const data = await readArtifact(directory, `database-${phase}.json`);
  const bookmarks = array(data.bookmarks).map((value) => {
    const row = object(value);
    return {
      id: integer(row.id, 1), owner_id: integer(row.owner_id, 1),
      title: string(row.title), url: string(row.url), is_archived: boolean(row.is_archived),
      unread: boolean(row.unread), shared: boolean(row.shared),
      date_added: string(row.date_added), date_modified: string(row.date_modified),
    };
  });
  const tags = array(data.tags).map((value) => {
    const row = object(value);
    return { id: integer(row.id, 1), owner_id: integer(row.owner_id, 1), name: string(row.name) };
  });
  const bookmarkTags = array(data.bookmark_tags).map((value) => {
    const row = object(value);
    return { bookmark_id: integer(row.bookmark_id, 1), tag_id: integer(row.tag_id, 1) };
  });
  requireValid(bookmarks.length === expectedCount, "snapshot count disagrees with collector");
  requireValid(new Set(bookmarks.map((row) => row.id)).size === bookmarks.length && new Set(tags.map((row) => row.id)).size === tags.length, "duplicate database identifiers");
  return { bookmarks, tags, bookmark_tags: bookmarkTags };
}

async function snapshots(directory: string, summary: Summary) {
  const [before, after] = await Promise.all([
    readSnapshot(directory, "before", summary.counts.before),
    readSnapshot(directory, "after", summary.counts.after),
  ]);
  return { targetId: summary.operation.targetId, before, after };
}

// A green browser test is insufficient to establish reference correctness. This
// gate validates only the supplied reference, never the run being investigated.
function validateKnownGood(state: Awaited<ReturnType<typeof snapshots>>): void {
  const { targetId, before, after } = state;
  const targetBefore = before.bookmarks.find((row) => row.id === targetId);
  const targetAfter = after.bookmarks.find((row) => row.id === targetId);
  requireValid(targetBefore && !targetBefore.is_archived && targetAfter?.is_archived,
    "known-good run must retain and archive its initially active target");
  requireValid(before.bookmarks.length === after.bookmarks.length,
    "known-good run changed the bookmark set");
  const afterById = new Map(after.bookmarks.map((row) => [row.id, row]));
  for (const row of before.bookmarks) {
    const final = afterById.get(row.id);
    const expected = row.id === targetId
      ? { ...row, is_archived: true, date_modified: targetAfter.date_modified }
      : row;
    requireValid(isDeepStrictEqual(final, expected),
      "known-good run changed a preserved bookmark field or row");
  }
  const byId = (a: { id: number }, b: { id: number }) => a.id - b.id;
  const byAssociation = (a: { bookmark_id: number; tag_id: number }, b: { bookmark_id: number; tag_id: number }) =>
    a.bookmark_id - b.bookmark_id || a.tag_id - b.tag_id;
  requireValid(isDeepStrictEqual([...before.tags].sort(byId), [...after.tags].sort(byId)) &&
    isDeepStrictEqual([...before.bookmark_tags].sort(byAssociation), [...after.bookmark_tags].sort(byAssociation)),
    "known-good run changed tags or bookmark/tag associations");
}

export async function loadLinkdingEvidence(currentDir: string, baselineDir: string): Promise<EvidenceSource> {
  const current = await readSummary(currentDir);
  return {
    initial: {
      test: { passed: true, scenario: "Archive an active bookmark" },
      operation: current.operation,
      counts: current.counts,
    },
    catalog: {
      database_state: "Current before/after bookmark, tag, and association snapshots for the observed operation.",
      operation_contract: "Pinned normal archive implementation and the state it preserves.",
      known_good_run: "Observed archive operation and database snapshots from a supplied known-good run.",
    },
    required: ["database_state", "operation_contract"],
    async retrieve(key): Promise<Json> {
      switch (key) {
        case "database_state": return snapshots(currentDir, current);
        case "operation_contract": return {
          operation: "Archive an active bookmark",
          requirements: [
            "Retain the existing bookmark and set is_archived to true.",
            "Update date_modified and save the bookmark; preserve its other stored fields.",
            "Preserve all other bookmarks, including those owned by other users; only the requested bookmark is saved.",
            "Preserve tags and bookmark/tag associations; this operation does not remove them.",
          ],
          source: { citation: SOURCE, function: "archive_bookmark", implementation: "Sets is_archived = True, sets date_modified = timezone.now(), saves, and returns the bookmark." },
        };
        case "known_good_run": {
          const baseline = await readSummary(baselineDir);
          const database = await snapshots(baselineDir, baseline);
          validateKnownGood(database);
          return { operation: baseline.operation, database };
        }
        default: throw new Error("Unknown evidence key");
      }
    },
  };
}
