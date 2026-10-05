import { expect, test, capture } from "../fixtures";
import type { Page } from "@playwright/test";

async function savedHistory(
  page: Page,
  onClear: () => Promise<{ status: number; error?: string }>,
) {
  let cleared = false;
  let deletions = 0;
  const conversations = ["first", "second"].map((threadId) => ({
    threadId,
    title: `Saved ${threadId}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "completed",
  }));

  await page.addInitScript(() => {
    if (localStorage.getItem("clear-test-initialized")) {
      return;
    }

    localStorage.setItem("clear-test-initialized", "true");
    localStorage.setItem(
      "agent-playground-conversation",
      '{"threadId":"first","empty":false}',
    );
    localStorage.setItem(
      "agent-playground-conversation:first",
      '{"threadId":"first","empty":false}',
    );
    localStorage.setItem(
      "agent-playground-conversation:second",
      '{"threadId":"second","empty":false}',
    );
    localStorage.setItem("agent-playground-preferences", '{"theme":"dark"}');
    localStorage.setItem("agent-playground-sidebar-width", "336");
  });
  // Bulk deletion is mocked so this browser test cannot clear another test's shared fixture history.
  await page.route(
    (url) => url.pathname === "/conversations",
    async (route) => {
      if (route.request().method() === "DELETE") {
        deletions += 1;
        const result = await onClear();

        if (result.status === 204) {
          cleared = true;
          await route.fulfill({ status: 204 });
        } else {
          await route.fulfill({
            status: result.status,
            json: { error: result.error },
          });
        }

        return;
      }

      await route.fulfill({
        json: { conversations: cleared ? [] : conversations, nextCursor: null },
      });
    },
  );
  await page.route(
    (url) => url.pathname === "/conversations/first",
    async (route) => {
      await route.fulfill({
        json: {
          title: "Saved first",
          messages: [
            {
              id: "first-message",
              role: "user",
              content: "My saved discussion",
            },
          ],
          outputs: [],
          interrupts: [],
          runs: [{ runId: "first-run", status: "completed" }],
        },
      });
    },
  );
  await page.goto("/c/first");
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(
    "My saved discussion",
  );

  return { deletions: () => deletions };
}

test("clear history requires confirmation and resets conversation data while retaining preferences", async ({
  page,
}, testInfo) => {
  const history = await savedHistory(page, () =>
    Promise.resolve({ status: 204 }),
  );

  await page.getByRole("button", { name: "Open settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });

  await settings
    .getByRole("button", { name: "Clear all conversations", exact: true })
    .click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Clear all conversations?",
    exact: true,
  });

  expect(history.deletions()).toBe(0);
  await expect(confirmation).toContainText("shared workspace");
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(history.deletions()).toBe(0);
  await settings
    .getByRole("button", { name: "Clear all conversations", exact: true })
    .click();
  await capture(page, testInfo, "clear-history-confirmation.png");
  await confirmation
    .getByRole("button", { name: "Delete all conversations", exact: true })
    .click();
  await expect(confirmation).not.toBeVisible();
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "What would you like to work on?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Saved (first|second)$/ }),
  ).toHaveCount(0);
  expect(history.deletions()).toBe(1);
  const pointers = await page.evaluate(() => ({
    first: localStorage.getItem("agent-playground-conversation:first"),
    second: localStorage.getItem("agent-playground-conversation:second"),
    preferences: JSON.parse(
      localStorage.getItem("agent-playground-preferences") ?? "{}",
    ) as { theme: string },
    width: localStorage.getItem("agent-playground-sidebar-width"),
    current: localStorage.getItem("agent-playground-conversation"),
  }));

  expect(pointers.first).toBeNull();
  expect(pointers.second).toBeNull();
  expect(pointers.preferences.theme).toBe("dark");
  expect(pointers.width).toBe("336");
  expect(pointers.current).toBeNull();
  expect(new URL(page.url()).pathname).toBe("/");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "What would you like to work on?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Saved (first|second)$/ }),
  ).toHaveCount(0);
});

test("mobile clear keeps settings open after successful deletion", async ({
  page,
}, testInfo) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const history = await savedHistory(page, async () => {
    await gate;

    return { status: 204 };
  });

  try {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("button", { name: "Open settings" }).click();
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });

    await settings
      .getByRole("button", { name: "Clear all conversations", exact: true })
      .click();
    const confirmation = page.getByRole("alertdialog", {
      name: "Clear all conversations?",
      exact: true,
    });

    await capture(page, testInfo, "clear-history-mobile.png");
    await confirmation
      .getByRole("button", { name: "Delete all conversations", exact: true })
      .click();
    await expect(
      confirmation.getByRole("button", { name: "Clearing…", exact: true }),
    ).toBeDisabled();
    await expect(
      confirmation.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(confirmation).toBeVisible();
    release();
    await expect(confirmation).not.toBeVisible();
    await expect(settings).toBeVisible();
    await settings.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "What would you like to work on?" }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog", {
        name: "Conversation navigation",
        exact: true,
      }),
    ).not.toBeVisible();
    expect(history.deletions()).toBe(1);
  } finally {
    release();
  }
});

test("the confirmation layer preserves settings layout and restores focus on cancellation", async ({
  page,
}) => {
  const history = await savedHistory(page, () =>
    Promise.resolve({ status: 204 }),
  );

  await page.getByRole("button", { name: "Open settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const trigger = settings.getByRole("button", {
    name: "Clear all conversations",
    exact: true,
  });
  const confirmation = page.getByRole("alertdialog", {
    name: "Clear all conversations?",
    exact: true,
  });
  const bounds = await settings.boundingBox();

  await trigger.click();
  await expect(confirmation).toBeVisible();
  expect(await settings.boundingBox()).toEqual(bounds);
  await expect(
    confirmation.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    confirmation.getByRole("button", {
      name: "Delete all conversations",
      exact: true,
    }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).not.toBeVisible();
  await expect(settings).toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await settings.boundingBox()).toEqual(bounds);
  await trigger.click();
  await page.mouse.click(8, 8);
  await expect(confirmation).not.toBeVisible();
  await expect(settings).toBeVisible();
  await expect(trigger).toBeFocused();
  expect(history.deletions()).toBe(0);
});
