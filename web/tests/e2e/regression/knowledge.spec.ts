import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "../fixtures";
import { createCompletedConversation } from "../conversations";

test("shared documents index through Python, retry failures and restore retrieved sources", async ({
  page,
  request,
}) => {
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
    await page.screenshot({ path: "/private/tmp/rag-knowledge.png" });
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
      const sources = page.getByRole("region", { name: "Retrieved sources" });

      await expect(sources).toBeVisible();
      await sources.getByText(filename, { exact: true }).click();
      await expect(sources).toContainText("30 days");
      const download = page.waitForEvent("download");

      await sources.getByRole("link", { name: "Download original" }).click();
      const file = await download;

      expect(file.suggestedFilename()).toBe(filename);
      expect(await readFile(await file.path(), "utf8")).toBe(content);
    }

    await page.screenshot({ path: "/private/tmp/rag-sources.png" });
    await page.goto("/knowledge");
    await row.getByRole("button", { name: `Delete ${filename}` }).click();
    await expect(row).toHaveCount(0);
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
