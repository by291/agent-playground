import { capture, expect, test } from "../fixtures";

test("an approved script with an unnamed receipt stays successful and its next approval submits", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Message", exact: true });

  await composer.fill(
    "Prepare a report with user input and consecutive approvals.",
  );
  await composer.press("Enter");
  const panel = page.getByRole("region", { name: "Agent needs your response" });

  await panel.getByRole("radio", { name: /Engineering/ }).click();
  await panel.getByRole("button", { name: "Next", exact: true }).click();
  await panel
    .getByRole("textbox", { name: "Your answer: When do you need the report?" })
    .fill("Friday");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await expect(panel).toContainText("Allow run skill script?");
  await panel.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(panel).toContainText("Allow remember memory?");
  await expect(
    page.getByRole("button", { name: "Skill reports Completed", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Memory remember_memory Waiting for your review/,
    }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await capture(page, testInfo, "script-complete-next-approval.png");
  await panel.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(composer).toBeEnabled();
  await expect(
    page.getByRole("button", {
      name: "Memory remember_memory Completed",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Skill reports Completed", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Memory remember_memory Completed",
      exact: true,
    }),
  ).toBeVisible();
});

test("confirmed clarification appears while the resumed reply is still streaming", async ({
  page,
  request,
}, testInfo) => {
  await page.goto("/");
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/agent",
  );
  const composer = page.getByRole("textbox", { name: "Message", exact: true });

  await composer.fill("Ask for report preferences and keep the response open.");
  await composer.press("Enter");
  const { threadId } = (await submitted).postDataJSON() as { threadId: string };
  const panel = page.getByRole("region", { name: "Agent needs your response" });

  await panel.getByRole("radio", { name: /Engineering/ }).click();
  await panel.getByRole("button", { name: "Next", exact: true }).click();
  await panel
    .getByRole("textbox", { name: "Your answer: When do you need the report?" })
    .fill("Friday afternoon");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  const answer = page.getByLabel("Your clarification response", {
    exact: true,
  });
  const replies = page.getByLabel("Assistant reply", { exact: true });

  // The fixture cannot finish until explicitly released, so these assertions
  // verify live receipt delivery independently of final history synchronization.
  await expect(replies.last()).toContainText(
    "I received your report preferences.",
  );
  await expect(answer).toBeVisible();
  await expect(answer).toContainText("Engineering");
  await expect(answer).toContainText("Friday afternoon");
  await expect(answer).toHaveCount(1);
  await expect(replies.last()).not.toContainText("The report is ready.");
  await capture(page, testInfo, "clarification-during-stream.png");
  const released = await request.post(
    `http://127.0.0.1:4300/__e2e/release/${threadId}`,
  );

  expect(released.ok()).toBe(true);
  await expect(replies.last()).toContainText("The report is ready.");
  await expect(composer).toBeEnabled();
  await expect(answer).toHaveCount(1);
  await page.reload();
  await expect(answer).toHaveCount(1);
  await expect(answer).toContainText("Friday afternoon");
  await expect(replies.last()).toContainText("The report is ready.");
});

test("clarification and approval replace the idle composer and recover after reload", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Message", exact: true });

  await composer.fill("Prepare a report with user input and approval.");
  await composer.press("Enter");
  const panel = page.getByRole("region", { name: "Agent needs your response" });

  await expect(panel).toContainText("Who will read this report?");
  await expect(composer).toBeHidden();
  const collapsedComposer = page.getByRole("group", {
    name: "Conversation input collapsed",
  });

  await expect(collapsedComposer).toBeVisible();
  expect((await collapsedComposer.boundingBox())!.height).toBeLessThanOrEqual(
    52,
  );
  await expect(page.getByLabel("Agent question")).toContainText(
    "Who will read this report?",
  );
  await expect(page.getByRole("button", { name: /Tool ask_user/ })).toHaveCount(
    0,
  );
  await expect(page.locator('textarea[aria-label="Message"]')).toHaveCount(1);
  await expect(panel.getByRole("radio", { name: /Engineering/ })).toBeEnabled();
  await expect(panel.getByRole("textbox")).toHaveCount(0);
  await expect(
    panel.getByRole("radio", { name: "Answer questions" }),
  ).toHaveCount(0);
  const desktopBounds = await panel.boundingBox();

  expect(desktopBounds!.height).toBeLessThan(400);
  await capture(page, testInfo, "clarification-desktop.png");
  await panel.getByRole("radio", { name: /Engineering/ }).click();
  await capture(page, testInfo, "clarification-selected-desktop.png");
  await page.setViewportSize({ width: 1280, height: 360 });
  await expect(
    panel.getByRole("button", { name: "Next", exact: true }),
  ).toBeInViewport();
  const shortBounds = await collapsedComposer.boundingBox();

  expect(shortBounds!.y + shortBounds!.height).toBeLessThanOrEqual(360);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.reload();
  await expect(panel).toContainText("Who will read this report?");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, testInfo, "clarification-mobile.png");
  const panelBounds = await panel.boundingBox();

  expect(panelBounds!.y + panelBounds!.height).toBeLessThan(844);
  await expect(composer).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );

  await expect(panel.getByRole("textbox")).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Write your own answer", exact: true })
    .click();
  await panel
    .getByRole("textbox", { name: "Your answer: Who will read this report?" })
    .fill("Operations");
  await capture(page, testInfo, "clarification-custom-mobile.png");

  await panel.getByRole("radio", { name: /Engineering/ }).click();
  await expect(panel.getByRole("textbox")).toHaveCount(0);
  await panel.getByRole("button", { name: "Next", exact: true }).click();
  await panel
    .getByRole("textbox", { name: "Your answer: When do you need the report?" })
    .fill("Friday afternoon");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  const answer = page.getByLabel("Your clarification response", {
    exact: true,
  });

  await expect(answer).toContainText("Engineering");
  await expect(answer).toContainText("Friday afternoon");
  await expect(answer).toHaveCount(1);
  await expect(panel).toContainText("Approval required");
  await expect(panel).toContainText("Allow run skill script?");
  await page.reload();
  await expect(answer).toHaveCount(1);
  await expect(answer).toContainText("Friday afternoon");
  await expect(panel).toContainText("Approval required");
  await page.setViewportSize({ width: 1280, height: 720 });
  await capture(page, testInfo, "approval-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByRole("radio")).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Allow once", exact: true }),
  ).toBeEnabled();
  await panel.getByText("Tool arguments", { exact: true }).click();
  await expect(panel).toContainText("scripts/export.py");
  await capture(page, testInfo, "approval-mobile.png");
  await panel.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(
    page.getByLabel("Assistant reply", { exact: true }).last(),
  ).toContainText("Report export completed.");
  await expect(composer).toBeEnabled();
  await expect(collapsedComposer).toHaveCount(0);
  await expect(composer).not.toBeFocused();
  await page.setViewportSize({ width: 1280, height: 720 });
  await capture(page, testInfo, "clarification-conversation-desktop.png");
});

test("skipped clarification restores without a fabricated user answer or technical tool row", async ({
  page,
}) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Message", exact: true });

  await composer.fill("Prepare a report with user input and approval.");
  await composer.press("Enter");
  const panel = page.getByRole("region", { name: "Agent needs your response" });

  await expect(panel).toContainText("Who will read this report?");
  await panel.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByLabel("Agent question")).toContainText(
    "Question skipped",
  );
  await expect(
    page.getByLabel("Your clarification response", { exact: true }),
  ).toHaveCount(0);
  await expect(composer).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("Agent question")).toContainText(
    "Question skipped",
  );
  await expect(
    page.getByLabel("Your clarification response", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Tool ask_user/ })).toHaveCount(
    0,
  );
});
