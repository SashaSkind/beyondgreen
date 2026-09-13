import { parseReceiptFile, compareSnapshots, object, safeLink, verdictNames, MAX_FILE_BYTES } from "/model.js";

const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const human = (value) => String(value).replaceAll("_", " ");
const providerName = (value) => ({ typesafe: "TypeSafe", deepseek: "DeepSeek", unknown: "Unknown model" }[value] ?? value);
const mark = (verdict) => ({ regression: "!", clean: "✓", insufficient: "?" }[verdict]);
const num = (value) => Number(value).toLocaleString("en-US");
const state = { dataset: null, selected: null, tab: "evidence", reference: null };
const saved = new URLSearchParams(location.search);
let loadVersion = 0;
const reasons = {
  verified: "The recorded evidence passed the investigation’s verification checks.",
  critic_unconvinced: "Required evidence was retrieved, but the Critic did not support a definite conclusion.",
  low_confidence: "The verification response did not meet the configured decision threshold.",
  model_error: "A model request or response failed. This is not a clean result.",
  incomplete_evidence: "The investigation stopped before retrieving all required evidence.",
  budget_exhausted: "The investigation reached its round limit without a verified conclusion.",
  insufficient_grounding: "The Verifier could not establish a conclusion from the recorded evidence.",
  verification_disagreed: "The Verifier disagreed with the investigation’s hypothesis.",
};
function notice(message) { $("#notice").hidden = !message; $("#notice").innerHTML = message ? `${escape(message)} <button id="dismiss">Dismiss</button>` : ""; }
function raw(value) { const text = JSON.stringify(value, null, 2) ?? "Not recorded"; return escape(text.length > 100000 ? text.slice(0, 100000) + "\n… Preview truncated. Export the receipt for the complete value." : text); }
function detail(label, value, caption = "JSON") { return `<details class="evidence-detail"><summary>${escape(label)}<span>${escape(caption)}</span></summary><pre>${raw(value)}</pre></details>`; }
function filtered() {
  const query = $("#search").value.trim().toLowerCase();
  return state.dataset.runs.filter(r => ($("#provider").value === "all" || r.provider === $("#provider").value) && ($("#verdict").value === "all" || r.verdict === $("#verdict").value) && `${r.title} ${r.model} ${r.raw.investigationId ?? ""}`.toLowerCase().includes(query));
}
function updateURL() {
  const params = new URLSearchParams();
  if (state.selected) params.set("run", state.selected);
  if (state.tab !== "evidence") params.set("tab", state.tab);
  params.set("provider", $("#provider").value);
  if ($("#verdict").value !== "all") params.set("verdict", $("#verdict").value);
  if ($("#search").value) params.set("q", $("#search").value);
  history.replaceState(null, "", `${location.pathname}?${params}`);
}
function renderList() {
  const runs = filtered();
  $("#run-count").textContent = `${runs.length}`;
  $("#run-list").innerHTML = runs.length ? runs.map(r => `<button class="run-button" data-run="${escape(r.id)}" aria-current="${r.id === state.selected}" aria-label="${escape(r.title)}, ${escape(providerName(r.provider))}, ${escape(verdictNames[r.verdict])}"><span class="run-top"><span class="status-mark ${r.verdict}" aria-hidden="true">${mark(r.verdict)}</span><span class="run-title">${escape(r.title)}</span></span><span class="run-bottom"><span>${escape(providerName(r.provider))}</span><span>${escape(verdictNames[r.verdict])}</span></span></button>`).join("") : `<div class="empty-list"><p>No runs match these filters.</p><button class="text-button" id="clear-filters">Clear filters</button></div>`;
  const active = $("#run-list").querySelector('[aria-current="true"]');
  if (active && matchMedia("(max-width: 760px)").matches) $("#run-list").scrollLeft = active.offsetLeft - $("#run-list").offsetLeft;
}
function valueCell(value) {
  if (value === undefined) return '<span class="value-missing">Not present</span>';
  if (value !== null && typeof value === "object") {
    const fields = Object.keys(value).length;
    if (fields <= 3) return `<code>${escape(JSON.stringify(value, null, 2))}</code>`;
    return `<span class="record-present">Record present</span>${typeof value.is_archived === "boolean" ? `<code class="record-field">is_archived: ${value.is_archived}</code>` : ""}<details class="record-value"><summary>View ${fields} fields</summary><pre>${raw(value)}</pre></details>`;
  }
  return `<code>${escape(value === null ? "null" : value)}</code>`;
}
function pathLabel(path) {
  const match = path.match(/^bookmarks\[id=(.+?)\](?:\.(.+))?$/);
  if (match) return `Bookmark ${match[1]}${match[2] ? ` · ${human(match[2])}` : ""}`;
  const tag = path.match(/^bookmark_tags\[bookmark_id=(.+?),tag_id=(.+?)\]$/);
  return tag ? `Bookmark ${tag[1]} · tag ${tag[2]}` : human(path);
}
function diffTable(run) {
  const db = object(run.retrieved.database_state);
  if (!("before" in db) || !("after" in db)) return '<div class="plain-empty">No before/after database snapshots were retrieved. Open the available evidence below.</div>';
  let changes;
  try { changes = compareSnapshots(db.before, db.after); } catch (error) { return `<div class="plain-empty">${escape(error.message)}</div>`; }
  if (!changes.length) return '<div class="plain-empty">No differences between the retrieved before and after snapshots.</div>';
  const shown = changes.slice(0, 100);
  return `<table class="change-table"><caption class="sr-only">Recorded database changes for ${escape(run.title)}</caption><thead><tr><th scope="col">Record / field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>${shown.map(c => `<tr><td><span class="path-label">${escape(pathLabel(c.path))}</span><code class="path-detail">${escape(c.path)}</code></td><td>${valueCell(c.before)}</td><td>${valueCell(c.after)}</td></tr>`).join("")}</tbody></table><p class="diff-note">${changes.length > 100 ? `Showing 100 of ${changes.length} changes. ` : ""}Computed from retrieved snapshots. Changes alone do not establish a defect.</p>`;
}
function evidencePanel(run) {
  const contract = object(run.retrieved.operation_contract);
  const requirements = Array.isArray(contract.requirements) ? contract.requirements : [];
  const citation = safeLink(object(contract.source).citation);
  return `<div class="section-heading"><h2>What changed</h2><span>Before → after</span></div><p class="section-note">The recorded state behind the test result.</p>${diffTable(run)}
    ${requirements.length ? `<section class="contract"><h2>What should have happened</h2><ol>${requirements.map(r => `<li>${escape(typeof r === "string" ? r : JSON.stringify(r))}</li>`).join("")}</ol>${citation ? `<p class="source-line">Contract source · <a href="${escape(citation)}" target="_blank" rel="noopener noreferrer">Pinned implementation ↗</a></p>` : ""}</section>` : ""}
    <div class="section-heading"><h2>Inspect the evidence</h2><span>${Object.keys(run.retrieved).length} retrieved sources</span></div>
    ${detail("Test & operation", run.initial, "Recorded initial state")}
    ${Object.entries(run.retrieved).map(([key, value]) => detail(human(key), value, key)).join("")}
    ${!Object.keys(run.retrieved).length ? '<div class="plain-empty">No evidence was retrieved in this investigation.</div>' : ""}`;
}
function tracePanel(run) {
  return `<div class="section-heading"><h2>How the verdict was reached</h2><span>${run.steps.length} recorded steps</span></div><p class="section-note">Recorded choices from each role. Scores are provider-specific and are not calibrated probabilities of correctness.</p>
  ${run.steps.length ? `<ol class="trace-list">${run.steps.map((step, index) => {
    const judgment = object(step.judgment), answers = object(judgment.answers);
    return `<li class="trace-step"><span class="step-number">${index + 1}</span><div class="step-content"><div class="step-heading"><h3>${escape(step.role ?? "Unknown role")}</h3><span>${typeof judgment.latencyMs === "number" ? `${(judgment.latencyMs / 1000).toFixed(2)} s` : "Timing not recorded"}</span></div>${Object.entries(answers).map(([name, value]) => `<div class="answer"><span>${escape(human(name))}</span><strong>${escape(human(object(value).choice ?? "Not recorded"))}</strong>${typeof object(value).confidence === "number" ? `<small class="muted">score ${Number(value.confidence).toFixed(2)}</small>` : ""}</div>`).join("")}<details><summary>Inspect recorded step</summary><pre>${raw(step)}</pre></details></div></li>`;
  }).join("")}</ol>` : '<div class="plain-empty">This receipt contains no completed model steps.</div>'}`;
}
function comparePanel(run) {
  const others = state.dataset.runs.filter(r => r.id !== run.id);
  if (!others.length) return '<div class="empty-workspace"><h2>Add a comparison run</h2><p class="section-note">Open an evaluation.json file containing multiple investigations to compare their recorded evidence.</p><button class="button" data-open>Open evaluation</button></div>';
  const reference = others.find(r => r.id === state.reference) ?? others.find(r => r.provider === run.provider && r.verdict === "clean" && r.title === run.title) ?? others.find(r => r.provider === run.provider && r.verdict === "clean") ?? others[0];
  state.reference = reference.id;
  return `<div class="section-heading"><h2>Compare recorded outcomes</h2></div><p class="section-note">Each column shows changes within that run. A clean model verdict alone does not qualify a run as a known-good reference.</p><div class="compare-picker"><label for="reference">Compare with</label><select id="reference">${others.map(r => `<option value="${escape(r.id)}" ${r.id === reference.id ? "selected" : ""}>${escape(r.title)} · ${escape(providerName(r.provider))} · ${escape(verdictNames[r.verdict])}</option>`).join("")}</select></div><div class="comparison">${[run, reference].map((r, i) => `<section><h3>${i ? "Comparison run" : "Selected run"}</h3><div class="compare-outcome ${r.verdict}">${escape(r.title)} · ${escape(providerName(r.provider))}<strong>${escape(verdictNames[r.verdict])}</strong><span class="muted">Test ${r.testPassed === null ? "outcome not recorded" : r.testPassed ? "passed" : "failed"} · ${(r.latencyMs / 1000).toFixed(2)} s</span></div>${diffTable(r)}</section>`).join("")}</div>`;
}
function renderMain() {
  const run = state.dataset.runs.find(r => r.id === state.selected);
  if (!run) { $("#workspace").innerHTML = '<div class="empty-workspace"><h1>No matching investigations</h1><p>Clear your filters to return to the recorded runs.</p><button class="button" id="clear-filters">Clear filters</button></div>'; return; }
  const op = object(run.initial.operation);
  const passText = run.testPassed === null ? "Not recorded" : run.testPassed ? "Passed" : "Failed";
  const description = { regression: "The investigator found evidence that the operation violated its contract.", clean: "The investigator found the observed operation consistent with its contract.", insufficient: "The investigator could not establish a definite conclusion." }[run.verdict];
  const shortId = typeof run.raw.investigationId === "string" ? run.raw.investigationId.slice(0, 8) : run.id;
  $("#workspace").innerHTML = `<div class="breadcrumb"><span>${escape(state.dataset.title)}</span><span aria-hidden="true">/</span><span class="run-id">${escape(shortId)}</span></div>
    <div class="page-heading"><div><h1>${escape(run.title)}</h1><p>${escape(object(run.initial.test).scenario ?? "Saved investigation receipt")}</p></div><button class="button" id="export" aria-label="Export selected receipt">Export receipt <span aria-hidden="true">↓</span></button></div>
    <div class="outcome"><section class="test-outcome ${run.testPassed === true ? "" : "unknown"}"><div class="outcome-label">Original test result</div><h2><span aria-hidden="true">${run.testPassed === true ? "✓" : run.testPassed === false ? "×" : "—"}</span>${passText}</h2><p class="muted">${op.method ? `${escape(op.method)} ${escape(op.path ?? "")} · HTTP ${escape(op.status ?? "unknown")}` : "HTTP outcome not recorded"}</p></section><section class="investigation-outcome ${run.verdict}"><div class="outcome-label">Beyond Green investigation</div><h2><span aria-hidden="true">${mark(run.verdict)}</span>${escape(verdictNames[run.verdict])}</h2><p>${description}</p></section></div>
    <div class="run-facts"><span class="fact">Model<strong>${escape(providerName(run.provider))}</strong></span><span class="fact">Investigation<strong>${(run.latencyMs / 1000).toFixed(2)} s</strong></span><span class="fact">Evidence<strong>${Object.keys(run.retrieved).length} sources</strong></span><span class="fact">Tokens<strong>${num(run.usage.inputTokens + run.usage.outputTokens)}</strong></span></div>
    <div class="tabs" role="tablist" aria-label="Investigation details">${[["evidence", "Evidence", Object.keys(run.retrieved).length], ["trace", "Agent trace", run.steps.length], ["compare", "Compare runs", null]].map(([key, label, count]) => `<button role="tab" id="tab-${key}" aria-controls="panel" aria-selected="${state.tab === key}" tabindex="${state.tab === key ? "0" : "-1"}" class="tab" data-tab="${key}">${label}${count === null ? "" : `<span>${count}</span>`}</button>`).join("")}</div>
    <div id="panel" class="panel" role="tabpanel" aria-labelledby="tab-${state.tab}">${state.tab === "trace" ? tracePanel(run) : state.tab === "compare" ? comparePanel(run) : evidencePanel(run)}</div>
    <div class="footer-note"><div>${escape(reasons[run.reason] ?? human(run.reason))}<br>Scope: ${escape(run.scope)}. Billed cost is not available.${run.traceUrl ? `<br>Trace verification in receipt: ${run.traceVerified ? "verified" : "not verified"}.` : ""}</div>${run.traceUrl ? `<a href="${escape(run.traceUrl)}" target="_blank" rel="noopener noreferrer">Open Weave trace ↗</a>` : ""}</div>
    ${Object.keys(state.dataset.source).length ? detail("Recording provenance", state.dataset.source, "Saved study · display projection") : ""}`;
  document.title = `${run.title} · ${verdictNames[run.verdict]} · Beyond Green`;
}
function render() { renderList(); renderMain(); updateURL(); }
function setDataset(dataset, useSaved = false) {
  state.dataset = dataset; state.reference = null;
  const providers = [...new Set(dataset.runs.map(r => r.provider))];
  $("#provider").innerHTML = '<option value="all">All models</option>' + providers.map(p => `<option value="${escape(p)}">${escape(providerName(p))}</option>`).join("");
  $("#provider").value = useSaved && ["all", ...providers].includes(saved.get("provider")) ? saved.get("provider") : providers.includes("typesafe") ? "typesafe" : "all";
  $("#verdict").value = useSaved && Object.hasOwn(verdictNames, saved.get("verdict")) ? saved.get("verdict") : "all";
  $("#search").value = useSaved ? saved.get("q") ?? "" : "";
  state.tab = useSaved && ["evidence", "trace", "compare"].includes(saved.get("tab")) ? saved.get("tab") : "evidence";
  const candidates = filtered();
  state.selected = (useSaved ? candidates.find(r => r.id === saved.get("run")) : null)?.id ?? candidates.find(r => r.verdict === "regression")?.id ?? candidates[0]?.id ?? null;
  $("#dataset-title").textContent = dataset.title;
  render();
}
async function loadDemo(useSaved = false) {
  const version = ++loadVersion;
  try {
    const response = await fetch("/demo.json");
    if (!response.ok) throw new Error("The demo recording could not be loaded. Retry Load demo or open a saved receipt.");
    const dataset = parseReceiptFile(await response.text(), "Linkding archive study");
    if (version !== loadVersion) return;
    setDataset(dataset, useSaved); notice("");
  } catch (error) {
    if (version !== loadVersion) return;
    notice(error.message);
    if (!state.dataset) $("#workspace").innerHTML = '<div class="empty-workspace"><h1>Open a saved investigation</h1><p>The demo recording is unavailable. Retry loading it or choose an investigation.json file.</p><button class="button primary" data-open>Open receipt</button></div>';
  }
}
$("#import").addEventListener("click", () => $("#file").click());
$("#load-demo").addEventListener("click", () => loadDemo());
$("#file").addEventListener("change", async (event) => {
  const file = event.target.files[0]; if (!file) return;
  const version = ++loadVersion;
  try {
    if (file.size > MAX_FILE_BYTES) throw new Error("File exceeds 12 MB. Open a single investigation receipt instead.");
    const dataset = parseReceiptFile(await file.text(), file.name);
    if (version !== loadVersion) return;
    setDataset(dataset); notice("");
  } catch (error) { if (version === loadVersion) notice(error.message); }
  finally { event.target.value = ""; }
});
for (const selector of ["#search", "#provider", "#verdict"]) $(selector).addEventListener(selector === "#search" ? "input" : "change", () => {
  if (!state.dataset) return;
  const candidates = filtered();
  if (!candidates.some(r => r.id === state.selected)) state.selected = candidates[0]?.id ?? null;
  state.reference = null; render();
});
document.addEventListener("click", (event) => {
  const button = event.target.closest("button"); if (!button) return;
  if (button.id === "dismiss") notice("");
  if (button.hasAttribute("data-open")) $("#file").click();
  if (button.id === "clear-filters") { $("#provider").value = "all"; $("#verdict").value = "all"; $("#search").value = ""; state.selected = state.dataset.runs[0].id; render(); }
  if (button.dataset.run) { state.selected = button.dataset.run; state.reference = null; render(); $("#run-list").querySelector('[aria-current="true"]')?.focus({ preventScroll: true }); }
  if (button.dataset.tab) { state.tab = button.dataset.tab; renderMain(); updateURL(); $(`#tab-${state.tab}`).focus(); }
  if (button.id === "export") {
    const run = state.dataset.runs.find(r => r.id === state.selected);
    const url = URL.createObjectURL(new Blob([JSON.stringify(run.raw, null, 2) + "\n"], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "investigation.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
});
document.addEventListener("change", (event) => { if (event.target.id === "reference") { state.reference = event.target.value; renderMain(); $("#reference").focus(); } });
document.addEventListener("keydown", (event) => {
  if (event.target.getAttribute("role") !== "tab" || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const tabs = ["evidence", "trace", "compare"], index = tabs.indexOf(state.tab);
  state.tab = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[2] : tabs[(index + (event.key === "ArrowRight" ? 1 : 2)) % 3];
  renderMain(); updateURL(); $(`#tab-${state.tab}`).focus();
});
loadDemo(true);
