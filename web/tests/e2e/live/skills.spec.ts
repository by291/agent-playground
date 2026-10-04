import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";

test("real agent processes an uploaded CSV in Docker and persists the S3 output link", async ({
  page,
  createConversation,
}) => {
  await createConversation();
  await page.getByLabel("Choose files").setInputFiles({
    name: "orders.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("item,amount\nalpha,12\nbeta,8\n"),
  });
  await page
    .getByRole("textbox", { name: "Message" })
    .fill(
      "$csv-summary Summarize the attached CSV using the published script and provide summary.json for download.",
    );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const link = page.getByRole("link", { name: /summary.json/ }).first();

  await expect(link).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
  await page.reload();
  await expect(link).toBeVisible();
  const downloaded = page.waitForEvent("download");

  await link.click();
  const download = await downloaded;
  const content: unknown = JSON.parse(
    await readFile(await download.path(), "utf8"),
  );

  expect(content).toEqual({
    rows: 2,
    columns: ["item", "amount"],
    numericTotals: { amount: 20 },
  });
});

test("real agent uses the HTTP Skill and publishes the returned JSON", async ({
  page,
  createConversation,
}) => {
  await createConversation();
  await page
    .getByRole("textbox", { name: "Message" })
    .fill(
      "$http-query Fetch https://httpbin.org/get using the published script and provide response.json for download.",
    );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const link = page.getByRole("link", { name: /response.json/ }).first();

  await expect(link).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
  const downloaded = page.waitForEvent("download");

  await link.click();
  const download = await downloaded;
  const content: unknown = JSON.parse(
    await readFile(await download.path(), "utf8"),
  );

  expect(content).toMatchObject({ url: "https://httpbin.org/get" });
});
