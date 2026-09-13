import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: ".scratch/viewer-tests",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:4312", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "npm run ui -- --port 4312", url: "http://127.0.0.1:4312", reuseExistingServer: false },
});
