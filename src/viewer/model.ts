// Shared by the local viewer and its tests. This module never invokes a judge.
type Value = Record<string, any>;
const record = (value: unknown): value is Value => value !== null && typeof value === "object" && !Array.isArray(value);
export const object = (value: unknown): Value => record(value) ? value : {};
export const MAX_FILE_BYTES = 12 * 1024 * 1024;
export const verdictNames = { regression: "Regression", clean: "Clean", insufficient: "Insufficient evidence" };
export type ViewerRun = {
  id: string; title: string; provider: string; model: string; verdict: keyof typeof verdictNames;
  reason: string; scope: string; testPassed: boolean | null; initial: Value;
  retrieved: Value; evidenceIds: string[]; steps: Value[]; latencyMs: number;
  usage: { inputTokens: number; outputTokens: number }; traceUrl: string | null;
  traceVerified: boolean; raw: Value;
};
export function safeLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export function parseReceiptFile(text: string, filename = "Investigation") {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error("File exceeds 12 MB. Open a single investigation receipt instead.");
  let data: Value;
  try { data = JSON.parse(text); } catch { throw new Error("This file is not valid JSON. Choose an investigation.json or evaluation.json file."); }
  if (!record(data)) throw new Error("Expected an investigation receipt or evaluation file.");
  const rows = data.format === "beyond-green-viewer/v1" ? data.runs : data.rows ?? [data];
  if (!Array.isArray(rows) || !rows.length || rows.length > 200) throw new Error("Choose a file containing between 1 and 200 investigation receipts.");
  const runs: ViewerRun[] = rows.map((r, index) => {
    const invalid = () => { throw new Error(`Receipt ${index + 1} is incomplete. Expected verdict, reason, evidence, steps, usage, and latency.`); };
    if (!record(r) || !Object.hasOwn(verdictNames, r.verdict) || typeof r.reason !== "string" || typeof r.scope !== "string" || !record(r.retrieved) || !Array.isArray(r.evidenceIds) || !r.evidenceIds.every((v: unknown) => typeof v === "string") || !Array.isArray(r.steps) || !r.steps.every(record) || !record(r.usage)) invalid();
    if (![r.latencyMs, r.usage.inputTokens, r.usage.outputTokens].every(v => typeof v === "number" && Number.isFinite(v) && v >= 0)) invalid();
    const initial = object(r.initial ?? object(r.steps[0]?.state).initial);
    const test = object(initial.test);
    const model = typeof r.steps[0]?.judgment?.model === "string" ? r.steps[0].judgment.model : "Not recorded";
    const provider = typeof r.provider === "string" ? r.provider : model.startsWith("jev") ? "typesafe" : /deepseek/i.test(model) ? "deepseek" : "unknown";
    return {
      id: `${index}-${typeof r.investigationId === "string" ? r.investigationId : "receipt"}`,
      title: typeof r.displayTitle === "string" ? r.displayTitle : typeof test.scenario === "string" ? test.scenario : filename,
      provider, model, verdict: r.verdict, reason: r.reason, scope: r.scope,
      testPassed: typeof test.passed === "boolean" ? test.passed : null, initial,
      retrieved: r.retrieved, evidenceIds: r.evidenceIds, steps: r.steps, latencyMs: r.latencyMs,
      usage: { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens },
      traceUrl: safeLink(r.traceUrl), traceVerified: r.traceVerified === true, raw: r,
    };
  });
  return { title: typeof data.title === "string" ? data.title : filename, source: object(data.source), runs };
}

export type Change = { path: string; before: unknown; after: unknown };
export function compareSnapshots(before: unknown, after: unknown): Change[] {
  const changes: Change[] = [];
  function walk(a: unknown, b: unknown, path: string, depth: number) {
    if (Object.is(a, b)) return;
    if (depth > 20 || changes.length >= 2000) throw new Error("Snapshot is too complex for a visual comparison. Inspect the raw evidence instead.");
    if (Array.isArray(a) && Array.isArray(b)) {
      const identity = (row: unknown) => record(row) && (typeof row.id === "number" || typeof row.id === "string") ? `id=${row.id}`
        : record(row) && typeof row.bookmark_id === "number" && typeof row.tag_id === "number" ? `bookmark_id=${row.bookmark_id},tag_id=${row.tag_id}` : null;
      const ak = a.map(identity), bk = b.map(identity);
      if ([...ak, ...bk].every(k => k !== null) && new Set(ak).size === a.length && new Set(bk).size === b.length) {
        const am = new Map(ak.map((k, i) => [k, a[i]])), bm = new Map(bk.map((k, i) => [k, b[i]]));
        for (const key of new Set([...ak, ...bk])) walk(am.get(key), bm.get(key), `${path}[${key}]`, depth + 1);
      } else for (let i = 0; i < Math.max(a.length, b.length); i++) walk(a[i], b[i], `${path}[${i}]`, depth + 1);
    } else if (record(a) && record(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(Object.hasOwn(a, key) ? a[key] : undefined, Object.hasOwn(b, key) ? b[key] : undefined, path ? `${path}.${key}` : key, depth + 1);
    } else changes.push({ path: path || "$", before: a, after: b });
  }
  walk(before, after, "", 0);
  return changes;
}
