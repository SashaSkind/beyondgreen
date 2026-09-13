import { test, expect } from "@playwright/test";

test("inspect an actual regression, its evidence, agent choices and a clean control", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Archive · capture 02" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Passed", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Regression", exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "bookmarks[id=2]" })).toContainText("Not present");
  await page.getByText("database state", { exact: false }).filter({ has: page.locator("span") }).first().click();
  await expect(page.locator("details[open] pre")).toContainText('"targetId": 2');
  await page.getByRole("tab", { name: "Agent trace" }).click();
  await expect(page.getByRole("heading", { name: "Verifier", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Compare runs" }).click();
  await expect(page.getByRole("heading", { name: "Comparison run", exact: true })).toBeVisible();
  await expect(page.locator(".comparison")).toContainText("Clean");
  await expect(page.locator(".comparison")).toContainText("is_archived");
  await page.getByRole("tab", { name: "Compare runs" }).press("Home");
  await expect(page.getByRole("tab", { name: "Evidence" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "What changed" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("filter abstentions, preserve state on reload, and recover from empty search", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Verdict", { exact: true }).selectOption("insufficient");
  await expect(page.locator(".run-button")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Insufficient evidence", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Verdict", { exact: true })).toHaveValue("insufficient");
  await expect(page.getByRole("heading", { name: "Insufficient evidence", exact: true })).toBeVisible();
  await page.getByLabel("Find a run").fill("no-such-recording");
  await expect(page.getByRole("heading", { name: "No matching investigations" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(page.locator(".run-button")).toHaveCount(12);
});

test("imports stay local, hostile strings stay text, and malformed files preserve the current run", async ({ page }) => {
  const outbound: string[] = [];
  page.on("request", request => { if (request.method() !== "GET" || !request.url().startsWith("http://127.0.0.1:4312")) outbound.push(request.url()); });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What changed" })).toBeVisible();
  await page.locator("#file").setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from('{"verdict":"clean"}') });
  await expect(page.getByRole("alert")).toContainText("incomplete");
  await expect(page.getByRole("heading", { name: "Archive · capture 02" })).toBeVisible();
  const receipt = { verdict: "insufficient", reason: "model_error", scope: "observed operation only", initial: { test: { scenario: '<img src=x onerror="alert(1)">' } }, retrieved: {}, evidenceIds: [], steps: [], usage: { inputTokens: 0, outputTokens: 0 }, latencyMs: 10, traceUrl: "javascript:alert(1)" };
  await page.locator("#file").setInputFiles({ name: "investigation.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(receipt)) });
  await expect(page.getByRole("heading", { name: receipt.initial.test.scenario, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Not recorded", exact: true })).toBeVisible();
  await expect(page.locator("main img")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open Weave trace" })).toHaveCount(0);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export selected receipt" }).click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(receipt);
  expect(outbound).toEqual([]);
});

for (const width of [375, 768, 1440]) test(`readable layout at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What changed" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `.scratch/viewer-${width}.png`, fullPage: true });
});

test("serves only viewer assets and recovers when demo loading fails", async ({ page, request }) => {
  for (const path of ["/.env", "/src/investigation/typesafe.ts", "/api/files", "/../package.json"]) expect((await request.get(path)).status()).toBe(404);
  expect((await request.post("/")).status()).toBe(405);
  await page.route("**/demo.json", route => route.fulfill({ status: 500, body: "unavailable" }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Open a saved investigation" })).toBeVisible();
  await page.unroute("**/demo.json");
  await page.getByRole("button", { name: "Load demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What changed" })).toBeVisible();
});
