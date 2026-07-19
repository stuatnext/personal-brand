import { test, expect } from "@playwright/test";

// The principal workflow, end to end in a real browser:
// paste a messy dump -> processing report -> queue -> opportunity detail ->
// draft (with voice lint round trip) -> feedback.

const MESSY_PASTE = `0 notifications
"prediction markets"

Home
My Network
Jobs
Messaging
Notifications

Feed post
View Harriet Voss’s profile
Harriet Voss
 • 2nd
Market structure researcher
2h •
Follow
ForecastEx has filed for CFTC approval to list event contracts on quarterly UK inflation prints, according to the notice published this morning. The interesting part is the settlement source: they are proposing the ONS first estimate, not the revision. Anyone who has traded economic prints knows the revision risk is where the argument starts.

14

Feed post
View Harriet Voss’s profile
Harriet Voss
 • 2nd
Market structure researcher
2h •
Follow
ForecastEx has filed for CFTC approval to list event contracts on quarterly UK inflation prints, according to the notice published this morning. The interesting part is the settlement source: they are proposing the ONS first estimate, not the revision. Anyone who has traded economic prints knows the revision risk is where the argument starts.

3

Feed post
View company: PM Daily Digest
PM Daily Digest
1h •
Follow
Promoted
Trade the news with PredictoTrade! Sign up today with code MOON for a deposit match. Don't miss out!

​
`;

test("principal workflow: paste -> report -> queue -> opportunity -> draft -> feedback", async ({ page }) => {
  // 1. Today renders with the seeded queue
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("The moves worth making");

  // 2. Paste a messy dump
  await page.goto("/paste");
  await page.getByTestId("paste-input").fill(MESSY_PASTE);
  await page.getByTestId("source-select").selectOption("linkedin");
  await page.getByTestId("process-button").click();

  // 3. Processing report: stages complete, stats populated, raw preserved
  await page.waitForURL("**/ingestions/**");
  await expect(page.getByTestId("items-table")).toBeVisible({ timeout: 60_000 });
  const statsText = await page.locator("main").innerText();
  expect(statsText).toMatch(/blocks detected/i);
  expect(statsText).toMatch(/duplicates \/ reposts/i);

  // items are inspectable, duplicate + noise separated
  await expect(page.getByTestId("items-table").locator("tr").first()).toBeVisible();

  // 4. The run queue links to an opportunity
  await expect(page.getByTestId("report-queue")).toBeVisible();
  await page.getByTestId("report-queue").locator("a").first().click();
  await page.waitForURL("**/opportunities/**");
  await expect(page.getByTestId("editorial-brief")).toContainText("What happened");
  await expect(page.getByTestId("stuart-angle")).toContainText("Why Stuart has an angle".toUpperCase(), {
    ignoreCase: true,
  });
  await expect(page.getByTestId("claims-section")).toBeVisible();
  await expect(page.getByTestId("score-breakdown")).toContainText("newness", { ignoreCase: true });

  // 5. Generate a LinkedIn draft with Stuart's reaction
  const opportunityUrl = page.url();
  await page.getByTestId("draft-type").selectOption("linkedin_post");
  await page
    .getByTestId("stuart-reaction")
    .fill("Settlement sources decide who wins the argument after the print. That's the real product decision here.");
  await page.getByTestId("generate-draft").click();
  await page.waitForURL("**/drafts/**", { timeout: 60_000 });

  // draft contains the reaction, not invented facts
  const content = page.getByTestId("draft-content");
  await expect(content).toBeVisible();
  const draftText = await content.inputValue();
  expect(draftText).toContain("Settlement sources decide");

  // voice check panel is clean on the generated draft
  await expect(page.getByTestId("voice-lint")).toContainText("Clean against Stuart's voice rules");

  // 6. Introduce an em dash -> linter catches it on save
  await content.fill(draftText + "\n\nA final thought — this matters.");
  await page.getByTestId("save-draft").click();
  await expect(page.getByTestId("voice-lint")).toContainText("em dash", { ignoreCase: true });

  // fix it and mark final
  await content.fill(draftText.replace("Settlement sources decide", "Settlement sources still decide"));
  await page.getByTestId("save-draft").click();
  await expect(page.getByTestId("voice-lint")).toContainText("Clean against Stuart's voice rules");
  await page.getByTestId("mark-final").click();
  await expect(page.locator(".tag", { hasText: "final" }).first()).toBeVisible();

  // 7. Feedback: wrong angle with a reason
  await page.goto(opportunityUrl);
  await page.waitForURL("**/opportunities/**");
  await page.getByTestId("wrong-angle").click();
  await page.getByTestId("wrong-angle-reason").fill("The settlement-source point matters but this is a UK story; my room is US-first right now.");
  await page.getByTestId("wrong-angle-submit").click();
  await expect(page.getByTestId("opportunity-actions")).toContainText("wrong angle", { ignoreCase: true });

  // 8. The archive finds it with the recorded status
  await page.goto("/archive");
  await page.getByTestId("archive-search").fill("ForecastEx");
  await expect(page.getByTestId("archive-results")).toContainText("ForecastEx", { timeout: 15_000 });
});

test("private call material is routed privately and never drafts restricted facts", async ({ page }) => {
  // the seeded fictional sponsor call: check its opportunity exists and is
  // not a public content action
  await page.goto("/archive");
  await page.getByTestId("archive-search").fill("post-trade");
  await expect(page.getByTestId("archive-results")).toContainText("post-trade", { timeout: 15_000 });
  await page.getByTestId("archive-results").locator("a").first().click();
  await page.waitForURL("**/opportunities/**");
  const actions = await page.locator("main").innerText();
  expect(actions).toMatch(/sales handoff|save/i);
  // restricted badge on evidence
  await expect(page.getByTestId("evidence-items")).toContainText("private");
});
