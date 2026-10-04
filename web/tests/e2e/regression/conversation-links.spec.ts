import { expect, test, type Page } from "@playwright/test";

async function saveDiscussion(page: Page, title: string) {
  const message = page.getByRole("textbox", { name: "Message" });

  await message.fill(title);
  await message.press("Enter");
  await expect(
    page.getByLabel("Assistant reply", { exact: true }),
  ).toContainText("The current time is");
  await expect(message).toBeEnabled();

  return page.url();
}

test("a copied conversation URL opens its discussion in a browser without local history", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  const title = `Linked discussion ${Date.now()}`;
  const link = await saveDiscussion(page, title);

  expect(new URL(link).pathname).toMatch(/^\/c\/[^/]+$/);
  const recipient = await browser.newContext();

  try {
    const opened = await recipient.newPage();
    let submissions = 0;

    opened.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/agent"
      ) {
        submissions += 1;
      }
    });
    await opened.goto(link);
    await expect(
      opened.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      opened.getByRole("region", { name: "Messages" }),
    ).toContainText(title);
    await expect(
      opened.getByLabel("Assistant reply", { exact: true }),
    ).toContainText("The current time is");
    await expect(
      opened.getByRole("textbox", { name: "Message" }),
    ).toBeEnabled();
    await opened.reload();
    await expect(
      opened.getByRole("region", { name: "Messages" }),
    ).toContainText(title);
    expect(submissions).toBe(0);
  } finally {
    await recipient.close();
  }
});

test("conversation URLs override the local pointer and browser history switches discussions", async ({
  page,
}) => {
  await page.goto("/?source=links#chat");
  const firstTitle = `First linked discussion ${Date.now()}`;
  const first = await saveDiscussion(page, firstTitle);
  const navigation = page.getByRole("complementary", {
    name: "Conversation navigation",
  });

  await navigation
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  const emptyLink = page.url();

  expect(emptyLink).not.toBe(first);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "What would you like to work on?" }),
  ).toBeVisible();
  const secondTitle = `Second linked discussion ${Date.now()}`;
  const second = await saveDiscussion(page, secondTitle);

  expect(second).not.toBe(first);
  await navigation
    .getByRole("button", { name: firstTitle, exact: true })
    .click();
  await expect(page).toHaveURL(first);
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(
    firstTitle,
  );
  await page.goBack();
  await expect(page).toHaveURL(second);
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(
    secondTitle,
  );
  await page.goForward();
  await expect(page).toHaveURL(first);
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(
    firstTitle,
  );
  await page.goto(second);
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(
    secondTitle,
  );
  await page.goto(first);
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(
    firstTitle,
  );
  expect(new URL(page.url()).searchParams.get("source")).toBe("links");
  expect(new URL(page.url()).hash).toBe("#chat");
});
