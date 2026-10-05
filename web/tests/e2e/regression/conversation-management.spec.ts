import { expect, test, capture } from "../fixtures";
import { randomUUID } from "node:crypto";
import { createCompletedConversation } from "../conversations";
import type { Locator } from "@playwright/test";

async function expectNavigationAlignment(navigation: Locator, title: string) {
  const sidebarBounds = (await navigation.boundingBox())!;
  const leftIcons = [
    navigation.locator('[data-slot="sidebar-header"] svg').first(),
    navigation
      .getByRole("button", { name: "New conversation", exact: true })
      .locator("svg"),
    navigation.getByRole("link", { name: "Knowledge" }).locator("svg"),
    navigation.getByRole("button", { name: title, exact: true }).locator("svg"),
    navigation.getByRole("status").locator("span").first(),
  ];
  const rightIcons = [
    navigation.getByRole("button", { name: "Refresh conversations" }),
    navigation.getByRole("button", { name: `Actions for ${title}` }),
    navigation.getByRole("button", { name: "Open settings" }),
  ];

  for (const icon of leftIcons) {
    const bounds = (await icon.boundingBox())!;

    expect(bounds.x + bounds.width / 2 - sidebarBounds.x).toBeCloseTo(32, 0);
  }

  for (const icon of rightIcons) {
    const bounds = (await icon.boundingBox())!;

    expect(
      sidebarBounds.x + sidebarBounds.width - (bounds.x + bounds.width / 2),
    ).toBeCloseTo(32, 0);
  }
}

test("history opens, renames and deletes a saved conversation after reload", async ({
  page,
  request,
}, testInfo) => {
  const title = `History check ${randomUUID()}`;
  const threadId = await createCompletedConversation(request, title);

  await page.goto(`/c/${threadId}`);
  const message = page.getByRole("textbox", { name: "Message" });

  await expect(message).toBeEnabled();
  const navigation = page.getByRole("complementary", {
    name: "Conversation navigation",
  });

  await expect(
    navigation.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
  await expectNavigationAlignment(navigation, title);
  await navigation
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "What would you like to work on?" }),
  ).toBeVisible();
  await navigation.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(
    title,
  );
  await expect(message).toBeEnabled();
  await navigation
    .getByRole("button", { name: `Actions for ${title}` })
    .click();

  for (const name of ["Rename", "Delete"]) {
    const bounds = (await page
      .getByRole("menuitem", { name, exact: true })
      .boundingBox())!;

    expect(bounds.height).toBe(32);
  }

  await page.keyboard.press("Escape");
  const actionTrigger = navigation.getByRole("button", {
    name: `Actions for ${title}`,
  });

  await expect(actionTrigger).toBeFocused();
  const focusIndicator = await actionTrigger.evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    const viewport = button
      .closest('[data-slot="scroll-area-viewport"]')!
      .getBoundingClientRect();
    const style = getComputedStyle(button);
    const width = Number.parseFloat(style.outlineWidth);
    const outset = Math.max(0, width + Number.parseFloat(style.outlineOffset));

    return {
      width,
      clipped:
        bounds.top - outset < viewport.top ||
        bounds.bottom + outset > viewport.bottom ||
        bounds.left - outset < viewport.left ||
        bounds.right + outset > viewport.right,
    };
  });

  expect(focusIndicator.width).toBeGreaterThan(0);
  expect(focusIndicator.clipped).toBe(false);
  await actionTrigger.click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const renamed = `Renamed ${title}`;

  await page.getByRole("textbox", { name: "Conversation title" }).fill(renamed);
  await page.getByRole("button", { name: "Save title" }).click();
  await expect(
    page.getByRole("heading", { name: renamed, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: renamed, exact: true }),
  ).toBeVisible();
  await capture(page, testInfo, "history-desktop.png");
  await navigation
    .getByRole("button", { name: `Actions for ${renamed}` })
    .click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await expect(
    navigation.getByRole("button", {
      name: renamed,
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "What would you like to work on?" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    navigation.getByRole("button", {
      name: renamed,
      exact: true,
    }),
  ).toHaveCount(0);
});

test("switching away from a live run preserves its recovery and does not resubmit", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const submitted = page.waitForRequest(
    (event) =>
      event.method() === "POST" && new URL(event.url()).pathname === "/agent",
  );
  const message = page.getByRole("textbox", { name: "Message" });

  const title = `Stream a code sample. ${randomUUID()}`;

  await message.fill(title);
  await message.press("Enter");
  const { threadId } = (await submitted).postDataJSON() as { threadId: string };

  await expect(
    page.getByLabel("Assistant reply", { exact: true }),
  ).toContainText("Here is a C example.");
  const navigation = page.getByRole("complementary", {
    name: "Conversation navigation",
  });

  await navigation
    .getByRole("button", { name: `Actions for ${title}`, exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Delete", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await navigation
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  const finished = await request.post(
    `http://127.0.0.1:4300/__e2e/release/${threadId}`,
  );

  expect(finished.ok()).toBe(true);
  let submissions = 0;

  page.on("request", (event) => {
    if (
      event.method() === "POST" &&
      new URL(event.url()).pathname === "/agent"
    ) {
      submissions += 1;
    }
  });
  await navigation.getByRole("button", { name: title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${threadId}$`));
  await expect(
    page.getByLabel("Assistant reply", { exact: true }),
  ).toContainText("int main(void)");
  await expect(message).toBeEnabled();
  expect(submissions).toBe(0);
});

test("mobile navigation supports rename and delete without leaving the drawer", async ({
  page,
  request,
}, testInfo) => {
  const title = `Mobile history ${randomUUID()}`;
  const threadId = await createCompletedConversation(request, title);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/c/${threadId}`);
  await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
  await page.getByRole("button", { name: "Open navigation" }).click();
  const navigation = page.getByRole("complementary", {
    name: "Conversation navigation",
  });

  await expectNavigationAlignment(navigation, title);
  await page.getByRole("button", { name: `Actions for ${title}` }).click();

  for (const name of ["Rename", "Delete"]) {
    const bounds = (await page
      .getByRole("menuitem", { name, exact: true })
      .boundingBox())!;

    expect(bounds.height).toBe(44);
  }

  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Conversation title" }),
  ).toBeFocused();
  const bounds = await page
    .getByRole("dialog", { name: "Rename conversation", exact: true })
    .boundingBox();

  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  const renamed = `Renamed ${title}`;

  await page.getByRole("textbox", { name: "Conversation title" }).fill(renamed);
  await capture(page, testInfo, "history-mobile.png");
  await page.getByRole("button", { name: "Save title" }).click();
  await expect(
    page.getByRole("button", { name: renamed, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: `Actions for ${renamed}` }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "What would you like to work on?" }),
  ).toBeVisible();
});

test("pending rename survives the navigation shortcut and a viewport change, then retries", async ({
  page,
  request,
}) => {
  const title = `Responsive rename ${randomUUID()}`;
  const threadId = await createCompletedConversation(request, title);
  const endpoint = `**/conversations/${threadId}`;
  let release: () => void = () => undefined;
  const responseGate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route(endpoint, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();

      return;
    }

    await responseGate;
    await route.fulfill({
      status: 503,
      json: { error: "Rename unavailable. Try again." },
    });
  });

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/c/${threadId}`);
    await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("button", { name: `Actions for ${title}` }).click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Rename conversation" });
    const draft = dialog.getByRole("textbox", { name: "Conversation title" });
    const renamed = `Renamed ${title}`;

    await draft.fill(renamed);
    const started = page.waitForRequest(
      (event) =>
        event.method() === "PATCH" &&
        event.url().endsWith(`/conversations/${threadId}`),
    );

    await dialog.getByRole("button", { name: "Save title" }).click();
    await started;
    await expect(
      dialog.getByRole("button", { name: "Saving…" }),
    ).toBeDisabled();
    await page.keyboard.press("Control+b");
    await expect(
      page.locator('[data-sidebar="sidebar"][data-slot="sheet-content"]'),
    ).toHaveAttribute("data-state", "open");
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(dialog).toBeVisible();
    await expect(draft).toHaveValue(renamed);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog.getByRole("alert")).toContainText(
      "Rename unavailable. Try again.",
    );
    await expect(draft).toBeEnabled();
    await expect(draft).toHaveValue(renamed);
    await page.unroute(endpoint);
    await dialog.getByRole("button", { name: "Save title" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: `Actions for ${renamed}` }),
    ).toBeFocused();
  } finally {
    release();
  }
});
