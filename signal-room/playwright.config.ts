import { defineConfig } from "@playwright/test";
import fs from "fs";

// Chromium is pre-installed in the dev container. When the Playwright
// version pins a browser build that is not present, fall back to the
// installed one instead of downloading.
function chromiumExecutable(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  try {
    const entries = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d));
    for (const dir of entries) {
      const candidate = `${root}/${dir}/chrome-linux/chrome`;
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    /* fall through to Playwright default resolution */
  }
  return undefined;
}

// The e2e suite boots its own dev server against a scratch database so it
// never touches real data.
export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4181",
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    launchOptions: { executablePath: chromiumExecutable() },
  },
  webServer: {
    command:
      "rm -rf .data/e2e && SIGNAL_ROOM_DATA_DIR=.data/e2e SIGNAL_ROOM_SEED_ON_BOOT=1 npm run dev -- -p 4181",
    url: "http://127.0.0.1:4181/api/health",
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
