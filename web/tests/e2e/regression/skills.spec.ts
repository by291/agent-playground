import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "../fixtures";
import { createCompletedConversation } from "../conversations";

test("uploaded files go through the real backend and recovered tool outputs download from S3", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByLabel("Choose files").setInputFiles({
    name: "orders.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("amount\n20\n"),
  });
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("Check the attached file.");
  const uploaded = page.waitForResponse(
    (response) =>
      response.url().endsWith("/files") &&
      response.request().method() === "POST",
  );

  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const response = await uploaded;

  expect(response.status()).toBe(201);
  const input = (await response.json()) as {
    id: string;
    threadId: string;
    name: string;
    size: number;
  };
  const bytes = await request.get(
    `http://127.0.0.1:4300/conversations/${input.threadId}/files/${input.id}`,
  );

  expect(await bytes.text()).toBe("amount\n20\n");
  await expect(
    page.getByRole("region", { name: "Messages" }).getByText(/Uploaded files:/),
  ).toBeVisible();
  const threadId = await createCompletedConversation(request, "Skill recovery");
  const fileResponse = await request.post(
    `http://127.0.0.1:4300/conversations/${threadId}/files`,
    {
      headers: { "X-File-Id": randomUUID(), "X-Filename": "summary.json" },
      data: '{"total":20}',
    },
  );

  expect(fileResponse.status()).toBe(201);
  const output: unknown = await fileResponse.json();
  const seeded = await request.post(
    `http://127.0.0.1:4300/__e2e/skill-result/${threadId}`,
    {
      data: output,
    },
  );

  expect(seeded.ok()).toBe(true);
  await page.goto(`/c/${threadId}`);
  await page.reload();
  const link = page.getByRole("link", { name: /summary.json/ });

  await expect(link).toBeVisible();
  const downloaded = page.waitForEvent("download");

  await link.click();
  const download = await downloaded;

  expect(download.suggestedFilename()).toBe("summary.json");
  expect(await readFile(await download.path(), "utf8")).toBe('{"total":20}');
});
