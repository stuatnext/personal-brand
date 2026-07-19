import { test, expect } from "@playwright/test";

// Captures the principal screens for the README/handoff. Runs against the
// seeded e2e database.
test("capture principal screens", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("The moves worth making");
  await page.screenshot({ path: "docs/screenshots/01-today.png", fullPage: false });

  await page.goto("/paste");
  await page.getByTestId("paste-input").fill("Feed post\nView Sample Person’s profile\nSample Person\n • 2nd\nAnalyst\n1h • \nExample paste content about prediction markets for the screenshot.\n");
  await page.screenshot({ path: "docs/screenshots/02-paste.png" });

  // a processed ingestion report from the seed
  await page.goto("/intelligence");
  await page.screenshot({ path: "docs/screenshots/03-intelligence.png" });
  await page.locator("table a").first().click();
  await page.waitForURL("**/ingestions/**");
  await page.waitForSelector("[data-testid=items-table]", { timeout: 60_000 });
  await page.screenshot({ path: "docs/screenshots/04-processing-report.png", fullPage: false });

  await page.goto("/");
  await page.locator('a[href*="/opportunities/"]').first().click();
  await page.waitForURL("**/opportunities/**");
  await page.waitForSelector("[data-testid=score-breakdown]");
  await page.screenshot({ path: "docs/screenshots/05-opportunity.png", fullPage: false });

  // generate a draft for the editor screenshot
  await page.getByTestId("generate-draft").click();
  await page.waitForURL("**/drafts/**", { timeout: 60_000 });
  await page.screenshot({ path: "docs/screenshots/06-draft-editor.png" });

  await page.goto("/archive");
  await page.waitForSelector("[data-testid=archive-results]");
  await page.screenshot({ path: "docs/screenshots/07-archive.png" });

  await page.goto("/people");
  await page.screenshot({ path: "docs/screenshots/08-people.png" });
});
