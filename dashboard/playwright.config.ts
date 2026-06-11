import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm dev",
    reuseExistingServer: true,
    url: "http://127.0.0.1:5173",
  },
});
