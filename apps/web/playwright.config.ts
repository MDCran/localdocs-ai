import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: process.env.E2E_URL ?? "http://localhost:5178",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:5178",
        reuseExistingServer: !process.env.CI,
      },
});
