import { test as base, expect } from "../fixtures";

export { expect } from "../fixtures";

export const test = base.extend<{ createConversation: () => Promise<string> }>({
  createConversation: async ({ page, request }, provide, info) => {
    const owned = new Set<string>();

    await provide(async () => {
      await page.goto("/");
      const previous = page.url();

      await page
        .getByRole("button", { name: "New conversation", exact: true })
        .filter({ visible: true })
        .click();
      await expect(page).not.toHaveURL(previous);
      const threadId = new URL(page.url()).pathname.split("/").at(-1)!;

      owned.add(threadId);

      return threadId;
    });
    const retained: string[] = [];

    for (const threadId of owned) {
      if (info.status !== "passed") {
        retained.push(threadId);
        continue;
      }

      // Delete exact IDs only. Never clear the existing stack's shared history.
      try {
        const response = await request.delete(
          `/conversations/${encodeURIComponent(threadId)}`,
        );

        if (!response.ok() && response.status() !== 404) {
          retained.push(threadId);
        }
      } catch {
        retained.push(threadId);
      }
    }

    if (retained.length > 0) {
      await info.attach("retained-conversations", {
        body: JSON.stringify({ threadIds: retained }, null, 2),
        contentType: "application/json",
      });
      expect(
        info.status !== "passed",
        "Successful live tests must release their conversations",
      ).toBe(true);
    }
  },
});
