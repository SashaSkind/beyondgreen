import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReceiptFile, compareSnapshots, safeLink } from "../src/viewer/model.ts";

test("opens a saved receipt without upgrading an abstention or inventing a passed test", () => {
  const receipt = { verdict: "insufficient", reason: "model_error", scope: "observed operation only", evidenceIds: [], retrieved: {}, steps: [], usage: { inputTokens: 0, outputTokens: 0 }, latencyMs: 50 };
  const [run] = parseReceiptFile(JSON.stringify(receipt), "receipt.json").runs;
  assert.equal(run.verdict, "insufficient");
  assert.equal(run.testPassed, null);
  assert.equal(run.traceUrl, null);
  assert.throws(() => parseReceiptFile('{"verdict":"clean"}', "bad.json"), /receipt/i);
});

test("compares rows by identity so deleting a bookmark does not shift every later row", () => {
  const before = { bookmarks: [{ id: 1, unread: false }, { id: 2, unread: false }, { id: 3, unread: false }], bookmark_tags: [{ bookmark_id: 2, tag_id: 7 }] };
  const after = { bookmarks: [{ id: 3, unread: false }, { id: 1, unread: true }], bookmark_tags: [] };
  assert.deepEqual(compareSnapshots(before, after), [
    { path: "bookmarks[id=1].unread", before: false, after: true },
    { path: "bookmarks[id=2]", before: { id: 2, unread: false }, after: undefined },
    { path: "bookmark_tags[bookmark_id=2,tag_id=7]", before: { bookmark_id: 2, tag_id: 7 }, after: undefined },
  ]);
  assert.equal(safeLink("javascript:alert(1)"), null);
  assert.equal(safeLink("https://example.com/trace"), "https://example.com/trace");
});
