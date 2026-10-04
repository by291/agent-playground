import { expect, test } from "@playwright/test";

test("history opens, renames and deletes a saved conversation after reload", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const message = page.getByRole("textbox", { name: "Message" });
  const title = `History check ${Date.now()}`;

  await message.fill(title);
  await message.press("Enter");
  await expect(message).toBeEnabled();
  const navigation = page.getByRole("complementary", {
    name: "Conversation navigation",
  });

  await expect(
    navigation.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Conversation title" })
    .fill("Renamed history check");
  await page.getByRole("button", { name: "Save title" }).click();
  await expect(
    page.getByRole("heading", { name: "Renamed history check", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Renamed history check", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("history-desktop.png") });
  await navigation
    .getByRole("button", { name: "Actions for Renamed history check" })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await expect(
    navigation.getByRole("button", {
      name: "Renamed history check",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "What would you like to work on?" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    navigation.getByRole("button", {
      name: "Renamed history check",
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

  await message.fill("Stream a code sample.");
  await message.press("Enter");
  const { threadId } = (await submitted).postDataJSON() as { threadId: string };

  await expect(
    page.getByLabel("Assistant reply", { exact: true }),
  ).toContainText("Here is a C example.");
  const navigation = page.getByRole("complementary", {
    name: "Conversation navigation",
  });

  await navigation
    .getByRole("button", { name: "Actions for Stream a code sample." })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Delete", exact: true }),
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
  await navigation
    .getByRole("button", { name: "Stream a code sample.", exact: true })
    .first()
    .click();
  await expect(
    page.getByLabel("Assistant reply", { exact: true }),
  ).toContainText("int main(void)");
  await expect(message).toBeEnabled();
  expect(submissions).toBe(0);
});

test("mobile navigation supports rename and delete without leaving the drawer", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const title = `Mobile history ${Date.now()}`;
  const message = page.getByRole("textbox", { name: "Message" });

  await message.fill(title);
  await message.press("Enter");
  await expect(message).toBeEnabled();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: `Actions for ${title}` }).click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Conversation title" }),
  ).toBeFocused();
  const bounds = await page
    .getByRole("dialog", { name: "Rename conversation", exact: true })
    .boundingBox();

  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page
    .getByRole("textbox", { name: "Conversation title" })
    .fill("Mobile renamed");
  await page.screenshot({ path: testInfo.outputPath("history-mobile.png") });
  await page.getByRole("button", { name: "Save title" }).click();
  await expect(
    page.getByRole("button", { name: "Mobile renamed", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Actions for Mobile renamed" })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "What would you like to work on?" }),
  ).toBeVisible();
});
