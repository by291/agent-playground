import { expect, test } from "../fixtures";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

test("image pixels reach the model through S3 and remain available after reload and follow-up", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByLabel("Choose files").setInputFiles({
    name: "screenshot.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("Describe this image.");
  const submission = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/agent",
  );

  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("The uploaded PNG pixel data reached the model.", {
      exact: true,
    }),
  ).toBeVisible();
  const input = (await submission).postDataJSON() as {
    threadId: string;
    messages: { content: string }[];
  };

  expect(input.messages.at(-1)?.content).toContain(
    '"screenshot.png" — File ID:',
  );
  expect(JSON.stringify(input)).not.toContain("base64");
  const saved = await request.get(
    `http://127.0.0.1:4300/conversations/${input.threadId}`,
  );

  expect(JSON.stringify(await saved.json())).not.toContain(
    png.toString("base64"),
  );
  await page.reload();
  await expect(
    page.getByText("The uploaded PNG pixel data reached the model.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("Is the previous image still available?");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("The previous image is still in model history.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("invalid image submission retains the prompt and attachment without starting a run", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Choose files").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a PNG"),
  });
  await page.getByRole("textbox", { name: "Message" }).fill("Read this image.");

  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Attach a valid JPEG, PNG, GIF or WebP image",
  );
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Read this image.",
  );
  await expect(page.getByText("broken.png", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
});
