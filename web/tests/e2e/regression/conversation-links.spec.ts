import { expect, test } from "../fixtures";
import { randomUUID } from "node:crypto";
import { createCompletedConversation } from "../conversations";

test("a copied conversation URL opens its discussion in a browser without local history", async ({
  page,
  browser,
  request,
}) => {
  const title = `Linked discussion ${randomUUID()}`;
  const threadId = await createCompletedConversation(request, title);

  await page.goto(`/c/${threadId}`);
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(
    title,
  );
  const link = page.url();

  expect(new URL(link).pathname).toMatch(/^\/c\/[^/]+$/);
  const recipient = await browser.newContext({ reducedMotion: "reduce" });

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
  request,
}) => {
  const firstTitle = `First linked discussion ${randomUUID()}`;
  const secondTitle = `Second linked discussion ${randomUUID()}`;

  await createCompletedConversation(request, firstTitle);
  await createCompletedConversation(request, secondTitle);
  await page.goto("/?source=links#chat");
  const navigation = page.getByRole("complementary", {
    name: "Conversation navigation",
  });

  await navigation
    .getByRole("button", { name: firstTitle, exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(
    firstTitle,
  );
  const first = page.url();

  await navigation
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  const emptyLink = page.url();

  expect(emptyLink).not.toBe(first);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "What would you like to work on?" }),
  ).toBeVisible();
  await navigation
    .getByRole("button", { name: secondTitle, exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(
    secondTitle,
  );
  const second = page.url();

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
