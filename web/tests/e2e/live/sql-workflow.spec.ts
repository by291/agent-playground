import { expect, test } from "@playwright/test";

test("a real SQL agent revises, explains, restores and submits checked SQL", async ({
  page,
}) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Message" });

  await composer.fill(
    "Use run_sql_workflow to list id and amount from paid orders. Use only the demo schema.",
  );
  await composer.press("Enter");
  await expect(
    page.getByRole("button", { name: "Accept and submit" }),
  ).toBeEnabled();
  await expect(page.getByLabel("SQL workflow")).toContainText("Check passed");
  const version = await page.getByLabel("SQL workflow").innerText();

  await expect(composer).toBeEnabled();
  await composer.fill("Explain this query without modifying the SQL.");
  await composer.press("Enter");
  await expect(
    page.getByRole("button", { name: "Accept and submit" }),
  ).toBeEnabled();
  await expect(composer).toBeEnabled();
  await expect(page.getByLabel("SQL workflow")).toContainText(
    /Version \d+/.exec(version)![0],
  );
  await composer.fill(
    "Change the SQL to return only id. Keep the paid status filter and provide the complete revised SQL.",
  );
  await composer.press("Enter");
  await expect(page.getByLabel("SQL workflow")).toContainText(
    `Version ${Number(/Version (\d+)/.exec(version)![1]) + 1}`,
  );
  await expect(
    page.getByRole("button", { name: "Accept and submit" }),
  ).toBeEnabled();
  await page.reload();
  await expect(
    page.getByText("Explain this query without modifying the SQL.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accept and submit" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Accept and submit" }).click();
  await expect(page.getByLabel("SQL workflow")).toContainText("SQL submitted");
  await expect(page.getByLabel("SQL workflow")).toContainText("Receipt:");
  await expect(composer).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("SQL workflow")).toContainText("SQL submitted");
});
