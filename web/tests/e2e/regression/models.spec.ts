import { randomUUID } from "node:crypto";
import { RunAgentInputSchema } from "@ag-ui/client";
import { expect, test } from "../fixtures";

test("model selection preserves the draft, survives reload and pins each run", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message" });

  await input.fill("Keep this model draft");
  await page.getByRole("button", { name: /test-model.*Choose model/ }).click();
  const qwen = page.getByRole("radio", { name: "Qwen", exact: true });

  await qwen.focus();
  await page.keyboard.press("Space");
  const selected = page.getByRole("button", {
    name: /test-qwen.*Choose model/,
  });

  await expect(selected).toBeFocused();
  await expect(input).toHaveValue("Keep this model draft");
  await page.reload();
  await expect(selected).toBeVisible();
  await expect(input).toBeEnabled();

  const posted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/agent",
  );

  await input.fill("Report the selected model");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const submission = RunAgentInputSchema.parse((await posted).postDataJSON());

  expect(submission.forwardedProps).toEqual({ modelId: "qwen" });
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(
    "Selected model: qwen",
  );
  await expect(input).toBeEnabled();
  await input.fill("Keep the next question");
  await selected.click();
  const changed = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname.endsWith("/model"),
  );

  await page.getByRole("radio", { name: "DeepSeek", exact: true }).click();
  expect((await changed).status()).toBe(200);
  await expect(
    page.getByRole("button", { name: /test-model.*Choose model/ }),
  ).toBeVisible();
  await expect(input).toHaveValue("Keep the next question");
  const snapshot = await page.request.get(
    `/conversations/${submission.threadId}`,
  );

  expect(await snapshot.json()).toMatchObject({
    modelId: "deepseek",
    runs: [{ modelId: "qwen", status: "completed" }],
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: /test-model.*Choose model/ }),
  ).toBeVisible();
  await expect(input).toBeEnabled();
  await input.fill("Report the selected model");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(
    "Selected model: deepseek",
  );
});

test("a running reply keeps context readable and disables model switching", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const posted = page.waitForRequest(
    (entry) =>
      entry.method() === "POST" && new URL(entry.url()).pathname === "/agent",
  );

  await page
    .getByRole("textbox", { name: "Message" })
    .fill(`Stream a code sample. ${randomUUID()}`);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const { threadId } = RunAgentInputSchema.parse((await posted).postDataJSON());

  try {
    await expect(page.getByRole("region", { name: "Messages" })).toContainText(
      "Here is a C example.",
    );
    await page
      .getByRole("button", { name: /test-model.*Choose model/ })
      .click();
    await expect(
      page.getByRole("radio", { name: "DeepSeek", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("radio", { name: "Qwen", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("heading", { name: "Context window" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Wait for conversation work to finish before changing models.",
      ),
    ).toBeVisible();
  } finally {
    await request.post(`http://127.0.0.1:4300/__e2e/release/${threadId}`);
  }
});
