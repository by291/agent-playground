import { expect, test, capture } from "../fixtures";

test.describe("reply animation preference", () => {
  test.use({ replyAnimation: true });

  test("settings change appearance, send shortcut and reply animation and survive reload", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    const composer = page.getByRole("textbox", { name: "Message" });
    const openSettings = page.getByRole("button", { name: "Open settings" });
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });

    await composer.fill("A multiline task.");
    await openSettings.click();
    await expect(settings).toBeVisible();
    await settings
      .getByRole("combobox", { name: "Appearance", exact: true })
      .click();
    await page.getByRole("option", { name: "Dark", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await settings
      .getByRole("combobox", { name: "Send shortcut", exact: true })
      .click();
    await page.getByRole("option", { name: "Ctrl / Cmd + Enter" }).click();
    await settings
      .getByRole("switch", { name: "Reply animation", exact: true })
      .click();
    await capture(page, testInfo, "settings-dark.png");
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
    await expect(
      settings.getByRole("combobox", { name: "Appearance", exact: true }),
    ).toHaveText("Dark");
    await expect(
      settings.getByRole("combobox", { name: "Send shortcut", exact: true }),
    ).toHaveText("Ctrl / Cmd + Enter");
    await expect(
      settings.getByRole("switch", { name: "Reply animation", exact: true }),
    ).not.toBeChecked();
    await settings.getByRole("button", { name: "Reset preferences" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(
      settings.getByRole("combobox", { name: "Send shortcut", exact: true }),
    ).toHaveText("Enter");
    await expect(
      settings.getByRole("switch", { name: "Reply animation", exact: true }),
    ).toBeChecked();
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
  await settings
    .getByRole("combobox", { name: "Appearance", exact: true })
    .click();
  await page.getByRole("option", { name: "Dark", exact: true }).click();
  await settings
    .getByRole("switch", { name: "Reply animation", exact: true })
    .click();
  await capture(page, testInfo, "settings-mobile.png");
  await page.keyboard.press("Escape");
  await expect(settings).not.toBeVisible();
  await expect(drawer).toBeVisible();
  await expect(trigger).toBeFocused();
  await drawer.getByRole("button", { name: "Close navigation" }).click();
  await expect(composer).toHaveValue("Keep this draft.");
});

test("settings dropdowns support keyboard selection and Escape closes only the menu", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const appearance = settings.getByRole("combobox", {
    name: "Appearance",
    exact: true,
  });

  await appearance.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Light", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("option", { name: "Dark", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(appearance).toHaveText("Dark");
  await expect(appearance).toBeFocused();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await appearance.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(settings).toBeVisible();
  await expect(appearance).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(settings).not.toBeVisible();
});

test("settings survive viewport changes and restore focus to the visible navigation control", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Message" });
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });

  await composer.fill("Keep the draft through settings resize.");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Collapse sidebar" }),
  ).toBeFocused();
  await expect(composer).toHaveValue("Keep the draft through settings resize.");
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeFocused();
  await expect(composer).toHaveValue("Keep the draft through settings resize.");
});
