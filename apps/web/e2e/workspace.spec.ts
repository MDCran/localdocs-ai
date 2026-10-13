import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

test("create collection, upload, inspect search, chat, and remove document", async ({
  page,
  request,
}) => {
  const name = "Project handbook";
  let collectionId = "";
  try {
    const screenshots = resolve(process.cwd(), "../../docs/screenshots");
    await mkdir(screenshots, { recursive: true });
    await page.setViewportSize({ width: 1536, height: 1100 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Overview" }),
    ).toBeVisible();
    await page.screenshot({ path: resolve(screenshots, "dashboard.png") });
    await page.goto("/collections");
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await page
      .getByRole("textbox", { name: "Description" })
      .fill("Operations and release notes for exploring local document search.");
    await page.getByRole("button", { name: "Save collection" }).click();
    await page.getByRole("link", { name, exact: true }).click();
    collectionId = page.url().split("/").pop()!;
    await page
      .locator("header")
      .getByRole("button", { name: "Upload documents" })
      .click();
    await page
      .getByLabel("Choose documents")
      .setInputFiles({
        name: "operations.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(
          "# Project operations\n\nThe archive retention period is 30 days.",
        ),
      });
    await page
      .getByRole("button", { name: "Upload 1 document", exact: true })
      .click();
    await expect(
      page.getByText("operations.md", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("table").getByText("Ready", { exact: true }),
    ).toBeVisible({ timeout: 90000 });
    await page.getByRole("button", { name: "View operations.md" }).click();
    await expect(
      page.getByRole("dialog").getByText(/archive retention period/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("link", { name: "Ask this collection" }).click();
    await page
      .getByRole("textbox", { name: "Your question" })
      .fill("What is the archive retention period?");
    await page.getByRole("button", { name: "Send question" }).click();
    await expect(
      page.getByRole("button", { name: "Copy response" }),
    ).toBeVisible({ timeout: 120000 });
    const answer = page.locator(".chat-message.message-assistant");
    await expect(answer).toHaveCount(1);
    await expect(answer).toContainText("30 days");
    await page.screenshot({ path: resolve(screenshots, "chat.png") });
    await page.reload();
    await expect(answer).toHaveCount(1);
    await expect(answer).toContainText("30 days");
    await page.getByRole("button", { name: /operations.md/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.goto(`/collections/${collectionId}`);
    await page.getByRole("button", { name: "Delete operations.md" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(
      page.getByText("operations.md", { exact: true }),
    ).not.toBeVisible({ timeout: 20000 });
  } finally {
    if (collectionId)
      await request.delete(`/api/v1/collections/${collectionId}`);
  }
});

test("mobile navigation, dark theme, and keyboard dialog access", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Overview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Collections", exact: true }).click();
  await page.getByRole("button", { name: "New collection" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
