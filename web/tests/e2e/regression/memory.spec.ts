import { randomUUID } from "node:crypto";
import { memoryPageSchema, memorySchema } from "../../../../shared/memory";
import { createCompletedConversation } from "../conversations";
import { capture, expect, test } from "../fixtures";

// Verifies real browser dialogs, source navigation and persistence through the
// public API, authenticated Python routes, LangMem and PostgreSQL Store.
test("saved memory can be corrected, reloaded and forgotten", async ({
  page,
  request,
}, testInfo) => {
  const threadId = await createCompletedConversation(
    request,
    `Memory ${randomUUID()}`,
  );
  const text = `Prefer concise answers ${randomUUID()}.`;
  const correctedText = `Prefer concrete examples ${randomUUID()}.`;
  const response = await request.post(
    `http://127.0.0.1:4300/__e2e/memory/${threadId}`,
    {
      data: { category: "preference", project: null, revision: 1, text },
    },
  );

  expect(response.ok()).toBe(true);
  const saved = memorySchema.parse(await response.json());

  await page.goto("/");
  await page.getByRole("link", { name: "Memory", exact: true }).click();
  const row = page.getByRole("listitem").filter({ hasText: text });

  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "Source conversation" }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${threadId}$`));
  await page.goBack();
  await row
    .getByRole("button", { name: `Correct memory: ${text}`, exact: true })
    .click();
  const correction = page.getByRole("dialog", {
    name: "Correct memory",
    exact: true,
  });

  await correction.getByLabel("Memory text").fill(correctedText);
  await correction.getByRole("button", { name: "Save correction" }).click();
  await expect(correction).toHaveCount(0);
  await page.reload();
  const correctedRow = page
    .getByRole("listitem")
    .filter({ hasText: correctedText });

  await expect(correctedRow).toBeVisible();
  const persistedResponse = await request.get("/api/memories");
  const persisted = memoryPageSchema.parse(await persistedResponse.json());

  expect(persisted.items).toContainEqual(
    expect.objectContaining({
      id: saved.id,
      text: correctedText,
      revision: 2,
      sourceThreadId: threadId,
    }),
  );
  await capture(page, testInfo, "memory-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    correctedRow.getByRole("button", { name: /^Forget memory:/ }),
  ).toBeInViewport();
  await capture(page, testInfo, "memory-mobile.png");
  await correctedRow.getByRole("button", { name: /^Forget memory:/ }).click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Forget memory?",
    exact: true,
  });

  await expect(confirmation).toContainText(correctedText);
  await confirmation
    .getByRole("button", { name: "Forget memory", exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  await expect(correctedRow).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to chat" })).toBeFocused();
  await page.reload();
  await expect(
    page.getByRole("listitem").filter({ hasText: correctedText }),
  ).toHaveCount(0);
  const after = await request.get("/api/memories");

  expect(memoryPageSchema.parse(await after.json()).items).not.toContainEqual(
    expect.objectContaining({ id: saved.id }),
  );
});
