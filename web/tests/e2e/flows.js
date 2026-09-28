import assert from "node:assert/strict";

// The caller supplies a browser tab. These flows use its Playwright locator API;
// they do not create a browser, replace storage, or intercept backend requests.
export async function verifyFreshWelcome(tab) {
  const page = tab.playwright;

  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("heading", { name: "A place to think out loud." })
    .waitFor({ state: "visible" });
  assert.equal(
    await page.getByRole("textbox", { name: "Message" }).isEnabled(),
    true,
  );
  await tab.reload();
  await page
    .getByRole("heading", { name: "A place to think out loud." })
    .waitFor({ state: "visible" });

  return "Fresh and restored empty conversations show the welcome page.";
}

export async function verifyToolReply(tab) {
  const page = tab.playwright;

  await page
    .getByRole("textbox", { name: "Message" })
    .fill("Use the time tool to tell me the current UTC time.");
  await page.getByRole("textbox", { name: "Message" }).press("Enter");
  await page
    .getByRole("button", { name: "Used 1 tool", exact: true })
    .waitFor({ state: "visible", timeoutMs: 45000 });
  await page
    .getByRole("button", { name: "Send message", exact: true })
    .waitFor({ state: "visible", timeoutMs: 45000 });
  const reply = page.getByLabel("Assistant reply", { exact: true });
  const text = await reply.innerText();

  assert.match(text, /UTC/);
  assert.equal(await reply.count(), 1);
  assert.equal(
    await page
      .getByRole("button", { name: "Used 1 tool" })
      .getAttribute("aria-expanded"),
    "false",
  );
  await page.getByRole("button", { name: "Used 1 tool" }).click();
  await page.getByRole("button", { name: /Check the time/ }).click();
  await page
    .getByText("get_current_time", { exact: true })
    .waitFor({ state: "visible" });
  await tab.reload();
  await page
    .getByRole("button", { name: "Used 1 tool" })
    .waitFor({ state: "visible" });
  assert.equal(await reply.count(), 1);
  assert.equal(
    await page
      .getByRole("button", { name: "Used 1 tool" })
      .getAttribute("aria-expanded"),
    "false",
  );
  assert.match(await reply.innerText(), /UTC/);

  return "Tool replies fold, expose details, and restore as one assistant reply.";
}

export async function startWorkflowReview(tab) {
  const page = tab.playwright;

  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("textbox", { name: "Message" })
    .fill(
      "Use run_experiment_workflow to make a simple experiment plan for testing an agent workflow. Ask me to review it.",
    );
  await page.getByRole("textbox", { name: "Message" }).press("Enter");
  await page
    .getByRole("button", { name: "Approve plan" })
    .waitFor({ state: "visible", timeoutMs: 45000 });
  assert.equal(
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .isEnabled(),
    false,
  );

  return "The workflow pauses with an editable plan and blocks new messages.";
}

export async function approveWorkflowReview(tab) {
  const page = tab.playwright;

  await page
    .getByLabel("Title", { exact: true })
    .fill("Frontend architecture smoke plan");
  await page
    .getByLabel("Steps, one per line")
    .fill("Check streaming\nCheck recovery");
  await page.getByRole("button", { name: "Approve plan" }).click();
  await page
    .getByRole("button", { name: "Send message", exact: true })
    .waitFor({ state: "visible", timeoutMs: 45000 });
  assert.equal(
    await page.getByRole("button", { name: "Approve plan" }).count(),
    0,
  );
  assert.equal(
    await page.getByLabel("Assistant reply", { exact: true }).count(),
    1,
  );
  await tab.reload();
  await page
    .getByRole("button", { name: "Used 1 tool", exact: true })
    .waitFor({ state: "visible" });
  await page
    .getByRole("heading", {
      name: "Frontend architecture smoke plan",
      exact: true,
    })
    .waitFor({ state: "visible" });
  assert.equal(
    await page.getByRole("button", { name: "Approve plan" }).count(),
    0,
  );
  assert.match(
    await page.getByRole("region", { name: "Messages" }).innerText(),
    /Frontend architecture smoke plan/,
  );

  return "Edited approval resumes the workflow and survives reload without another review.";
}

export async function verifyGallerySelection(tab) {
  const page = tab.playwright;

  await page.getByRole("combobox", { name: "Component", exact: true }).click();
  await page.getByRole("option", { name: "WorkflowText", exact: true }).click();
  assert.match(
    await page
      .getByRole("combobox", { name: "Component", exact: true })
      .innerText(),
    /WorkflowText/,
  );
  await page
    .getByRole("status")
    .filter({ hasText: "Valid A2UI JSON" })
    .waitFor({ state: "visible" });

  return "The shared component selector switches to a valid WorkflowText preview.";
}
