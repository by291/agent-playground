import { expect, test } from "@playwright/test";

test("settings change appearance, send shortcut and reply animation and survive reload", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Message" });
  const openSettings = page.getByRole("button", { name: "Open settings" });
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });

  await composer.fill("A multiline task.");
  await openSettings.click();
  await expect(settings).toBeVisible();
  await settings.getByLabel("Appearance", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await settings
    .getByLabel("Send shortcut", { exact: true })
    .selectOption("modifier-enter");
  await settings
    .getByLabel("Reply animation", { exact: true })
    .selectOption("off");
  await page.screenshot({ path: testInfo.outputPath("settings-dark.png") });
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await expect(openSettings).toBeFocused();
  await expect(composer).toHaveValue("A multiline task.");
  let submissions = 0;

  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/agent"
    ) {
      submissions += 1;
    }
  });
  await composer.press("Enter");
  await expect(composer).toHaveValue("A multiline task.\n");
  expect(submissions).toBe(0);
  await composer.fill("A multiline task.\nSecond line.");
  await composer.evaluate((element) => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        isComposing: true,
        bubbles: true,
      }),
    );
  });
  expect(submissions).toBe(0);
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/agent",
  );

  await composer.press("Control+Enter");
  const input = (await submitted).postDataJSON() as {
    messages: { content: string }[];
  };

  expect(input.messages.at(-1)?.content).toBe(
    "A multiline task.\nSecond line.",
  );
  expect(submissions).toBe(1);
  await expect(composer).toBeEnabled();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await openSettings.click();
  await expect(settings.getByLabel("Appearance", { exact: true })).toHaveValue(
    "dark",
  );
  await expect(
    settings.getByLabel("Send shortcut", { exact: true }),
  ).toHaveValue("modifier-enter");
  await expect(
    settings.getByLabel("Reply animation", { exact: true }),
  ).toHaveValue("off");
  await settings
    .getByLabel("Appearance", { exact: true })
    .selectOption("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await settings.getByRole("button", { name: "Reset preferences" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(
    settings.getByLabel("Send shortcut", { exact: true }),
  ).toHaveValue("enter");
  await expect(
    settings.getByLabel("Reply animation", { exact: true }),
  ).toHaveValue("on");
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(
    "A multiline task.",
  );
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await openSettings.click();
  await expect(settings).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(openSettings).toBeFocused();
});

test("settings work inside mobile navigation and closing them preserves the drawer and draft", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Message" });

  await composer.fill("Keep this draft.");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", {
    name: "Conversation navigation",
    exact: true,
  });
  const trigger = drawer.getByRole("button", { name: "Open settings" });

  await trigger.click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const bounds = (await settings.boundingBox())!;

  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await settings.getByLabel("Appearance", { exact: true }).selectOption("dark");
  await settings
    .getByLabel("Reply animation", { exact: true })
    .selectOption("off");
  await page.screenshot({ path: testInfo.outputPath("settings-mobile.png") });
  await page.keyboard.press("Escape");
  await expect(settings).not.toBeVisible();
  await expect(drawer).toBeVisible();
  await expect(trigger).toBeFocused();
  await drawer.getByRole("button", { name: "Close navigation" }).click();
  await expect(composer).toHaveValue("Keep this draft.");
});
