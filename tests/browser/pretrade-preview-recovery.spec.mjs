import { test, expect } from "@playwright/test";

test("lost POST response exposes only outcome recovery, then shows the original admitted result", async ({ page }) => {
  await page.goto("/tests/browser/pretrade-preview-harness.html?mode=lost-post");
  await expect(page.getByText(/Importing this card does not verify the setup/)).toBeVisible();
  await page.getByRole("button", { name: "ACCEPT INTO PRETRADE" }).click();
  await expect(page.getByText(/Outcome unknown/)).toBeVisible();
  await expect(page.getByRole("button", { name: "DISCARD PREVIEW" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ACCEPT INTO PRETRADE" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "REFRESH EVIDENCE" })).toHaveCount(0);
  await page.getByRole("button", { name: "CHECK OUTCOME" }).click();
  await expect(page.getByText(/Current PRETRADE state: WAITING/)).toBeVisible();
  await expect(page.getByText(/Imported into PRETRADE — trading review required/)).toBeVisible();
  await expect(page.getByText(/no permission, ARM, order or broker authority/)).toBeVisible();
});

test("durable receipt remains visible when follow-up status fails and can be reconciled", async ({ page }) => {
  await page.goto("/tests/browser/pretrade-preview-harness.html?mode=lost-status");
  await page.getByRole("button", { name: "ACCEPT INTO PRETRADE" }).click();
  await expect(page.getByText(/Admission receipt: ADMITTED/)).toBeVisible();
  await expect(page.getByText(/awaiting reconciliation/)).toBeVisible();
  await expect(page.getByRole("button", { name: "DISCARD PREVIEW" })).toHaveCount(0);
  await page.getByRole("button", { name: "CHECK OUTCOME" }).click();
  await expect(page.getByText(/Current PRETRADE state: WAITING/)).toBeVisible();
});

test("discard before acceptance shows durable-discard wording without admission controls", async ({ page }) => {
  await page.goto("/tests/browser/pretrade-preview-harness.html");
  await page.getByRole("button", { name: "DISCARD PREVIEW" }).click();
  await expect(page.getByText(/this preview imported nothing/)).toBeVisible();
  await expect(page.getByRole("button", { name: "ACCEPT INTO PRETRADE" })).toHaveCount(0);
});
