import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { knowledgeSearchSchema } from "../../../../shared/knowledge";
import { capture, expect, test } from "../fixtures";
import { createCompletedConversation } from "../conversations";

test("shared documents index through Python, retry failures and restore retrieved sources", async ({
  page,
  request,
}, testInfo) => {
  const filename = `policy-${randomUUID()}.md`;
  const content =
    "# Returns\nReturns are allowed within 30 days. Keep the original receipt.";

  await request.post("http://127.0.0.1:4300/__e2e/embedding-failure", {
    data: { enabled: true },
  });

  try {
    await page.goto("/");
    await page.getByRole("link", { name: "Knowledge", exact: true }).click();
    await page.getByLabel("Document file").setInputFiles({
      name: filename,
      mimeType: "text/markdown",
      buffer: Buffer.from(content),
    });
    const row = page.getByRole("listitem").filter({ hasText: filename });

    await expect(
      row.getByRole("button", { name: "Retry indexing" }),
    ).toBeVisible();
    await request.post("http://127.0.0.1:4300/__e2e/embedding-failure", {
      data: { enabled: false },
    });
    await row.getByRole("button", { name: "Retry indexing" }).click();
    await expect(row).toContainText("ready");
    await capture(page, testInfo, "knowledge-ready.png");
    const documentUrl = await row
      .getByRole("link", { name: "Download", exact: true })
      .getAttribute("href");

    expect(documentUrl).toBeTruthy();

    for (const title of [
      "Returns question",
      "Another shared knowledge question",
    ]) {
      const threadId = await createCompletedConversation(request, title);
      const result = await request.post(
        `http://127.0.0.1:4300/__e2e/knowledge-result/${threadId}`,
      );

      expect(result.ok()).toBe(true);
      await page.goto(`/c/${threadId}`);
      await page.reload();
      const trigger = page.getByRole("button", {
        name: /Sources · 1 document/,
      });
      const sources = page.getByRole("dialog", {
        name: "Sources",
        exact: true,
      });

      await expect(trigger).toBeVisible();
      await expect(sources).toHaveCount(0);
      const citation = page.getByRole("button", {
        name: `Source 1: ${filename}`,
        exact: true,
      });

      await expect(citation).toHaveText("[1]");
      await citation.click();
      await expect(sources).toContainText("Source [1]");
      await expect(sources).toContainText("30 days");
      await page.keyboard.press("Escape");
      await expect(citation).toBeFocused();
      await trigger.click();
      await expect(sources).toContainText("30 days");
      await expect(sources.getByText(filename, { exact: true })).toBeVisible();
      await expect(sources.getByRole("combobox")).toHaveCount(0);
      await expect(sources).toContainText("Passage 1 of 1");
      await expect(
        sources.getByRole("button", { name: "Next passage" }),
      ).toBeDisabled();
      await capture(page, testInfo, "knowledge-sources-desktop.png");

      for (const dark of [false, true]) {
        await page.evaluate(
          (enabled) =>
            document.documentElement.classList.toggle("dark", enabled),
          dark,
        );
        await page.setViewportSize({ width: 390, height: 844 });
        const box = await sources.boundingBox();

        expect(box!.x).toBe(0);
        expect(box!.width).toBe(390);
        await expect(
          sources.getByRole("button", { name: "Close sources" }),
        ).toBeVisible();
        await capture(
          page,
          testInfo,
          `knowledge-sources-mobile-${dark ? "dark" : "light"}.png`,
        );
      }

      await page.evaluate(() =>
        document.documentElement.classList.remove("dark"),
      );
      await page.setViewportSize({ width: 1280, height: 720 });
      const download = page.waitForEvent("download");

      await sources.getByRole("link", { name: "Download original" }).click();
      const file = await download;

      expect(file.suggestedFilename()).toBe(filename);
      expect(await readFile(await file.path(), "utf8")).toBe(content);
      await page.keyboard.press("Escape");
      await expect(sources).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }

    const courierFilename = `courier-return-policy-${randomUUID()}.md`;

    await page.goto("/knowledge");
    await page.getByLabel("Document file").setInputFiles({
      name: courierFilename,
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Returns\nFor courier returns, contact the delivery desk.",
      ),
    });
    const courierRow = page
      .getByRole("listitem")
      .filter({ hasText: courierFilename });

    await expect(courierRow).toContainText("ready");
    const combinedThread = await createCompletedConversation(
      request,
      "Compare return policies",
    );
    const combined = await request.post(
      `http://127.0.0.1:4300/__e2e/knowledge-result/${combinedThread}`,
    );

    expect(combined.ok()).toBe(true);
    const retrieved = knowledgeSearchSchema.parse(await combined.json());
    const courierNumber =
      retrieved.sources.findIndex((source) => source.name === courierFilename) +
      1;

    expect(courierNumber).toBeGreaterThan(0);
    await page.goto(`/c/${combinedThread}`);
    await page.getByRole("button", { name: /Sources · 2 documents/ }).click();
    const reader = page.getByRole("dialog", { name: "Sources", exact: true });
    const selector = reader.getByRole("combobox", { name: "Document" });

    await selector.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await capture(page, testInfo, "knowledge-document-menu-desktop.png");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(reader).toBeVisible();
    await expect(selector).toBeFocused();
    await selector.click();
    await page
      .getByRole("option", { name: courierFilename, exact: true })
      .click();
    await expect(selector).toContainText(courierFilename);
    await expect(reader).toContainText("contact the delivery desk");
    await expect(reader).toContainText("Passage 1 of 1");

    for (const dark of [false, true]) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(
        (enabled) => document.documentElement.classList.toggle("dark", enabled),
        dark,
      );
      await selector.click();
      await expect(page.getByRole("listbox")).toBeVisible();
      const menu = await page.getByRole("listbox").boundingBox();

      expect(menu!.x).toBeGreaterThanOrEqual(0);
      expect(menu!.x + menu!.width).toBeLessThanOrEqual(390);
      await capture(
        page,
        testInfo,
        `knowledge-document-menu-mobile-${dark ? "dark" : "light"}.png`,
      );
      await page.keyboard.press("Escape");
      await expect(reader).toBeVisible();
    }

    await selector.click();
    await page.getByRole("option", { name: filename, exact: true }).click();
    await expect(reader).toContainText("30 days");
    await reader.getByRole("button", { name: "Close sources" }).click();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload();
    const citation = page.getByRole("button", {
      name: `Source ${courierNumber}: ${courierFilename}`,
      exact: true,
    });

    await expect(citation).toBeVisible();
    await capture(page, testInfo, "knowledge-answer-footnotes.png");
    await citation.click();
    await expect(reader).toContainText(`Source [${courierNumber}]`);
    await expect(reader).toContainText("contact the delivery desk");
    await capture(page, testInfo, "knowledge-inline-citation.png");
    await reader.getByRole("button", { name: "Close sources" }).click();
    await page.goto("/knowledge");
    await row.getByRole("button", { name: `Delete ${filename}` }).click();
    await page
      .getByRole("dialog", { name: "Delete document?" })
      .getByRole("button", { name: "Delete document", exact: true })
      .click();
    await expect(row).toHaveCount(0);
    await courierRow
      .getByRole("button", { name: `Delete ${courierFilename}` })
      .click();
    await page
      .getByRole("dialog", { name: "Delete document?" })
      .getByRole("button", { name: "Delete document", exact: true })
      .click();
    await expect(courierRow).toHaveCount(0);
    expect(
      (await request.get(`http://127.0.0.1:4300${documentUrl}`)).status(),
    ).toBe(404);
    const threadId = await createCompletedConversation(
      request,
      "Deleted knowledge",
    );
    const result = await request.post(
      `http://127.0.0.1:4300/__e2e/knowledge-result/${threadId}`,
    );

    expect(await result.json()).toMatchObject({ sources: [] });
  } finally {
    await request.post("http://127.0.0.1:4300/__e2e/embedding-failure", {
      data: { enabled: false },
    });
  }
});
