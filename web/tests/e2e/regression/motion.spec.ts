import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

const documentId = "00000000-0000-4000-8000-000000000001";
const chunkId = "00000000-0000-4000-8000-000000000002";

async function installConversation(page: Page) {
  const snapshot = {
    title: "Motion fixture",
    messages: [
      { id: "question", role: "user", content: "Explain the return policy" },
      {
        id: "reasoning",
        role: "reasoning",
        content: "Check the policy document first.",
      },
      {
        id: "call",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "search",
            type: "function",
            function: { name: "search_knowledge", arguments: "{}" },
          },
        ],
      },
      {
        id: "result",
        role: "tool",
        toolCallId: "search",
        content: JSON.stringify({
          kind: "knowledge_search_result",
          query: "returns",
          error: null,
          sources: [
            {
              chunkId,
              documentId,
              name: "policy.md",
              page: null,
              excerpt: "Returns within 30 days.",
              distance: 0.1,
            },
          ],
        }),
      },
      {
        id: "answer",
        role: "assistant",
        content: `Returns within 30 days [1](#knowledge-source-${chunkId}).`,
      },
    ],
    outputs: [],
    interrupts: [],
    runs: [{ runId: "motion-run", messageId: "question", status: "completed" }],
  };

  await page.route(
    (url) => url.pathname.startsWith("/conversations"),
    async (route) => {
      const path = new URL(route.request().url()).pathname;

      if (path === "/conversations") {
        await route.fulfill({
          json: {
            conversations: [
              {
                threadId: "motion-fixture",
                title: "Motion fixture",
                status: "completed",
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
              },
            ],
            nextCursor: null,
          },
        });
      } else if (path.endsWith("/events")) {
        await route.fulfill({
          contentType: "text/event-stream",
          body: ": fixture\n\n",
        });
      } else {
        await route.fulfill({ json: snapshot });
      }
    },
  );
}

test.describe("normal motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("rename dialogs retain their control size during their entrance", async ({
    page,
  }) => {
    await installConversation(page);
    await page.goto("/c/motion-fixture");
    await page
      .getByRole("button", { name: "Actions for Motion fixture" })
      .click();
    const menu = page.getByRole("menu");

    await expect
      .poll(() => menu.evaluate((element) => getComputedStyle(element).opacity))
      .toBe("1");
    const scales = await page
      .getByRole("menuitem", { name: "Rename", exact: true })
      .evaluate(async (element) => {
        (element as HTMLElement).click();
        const samples: number[] = [];

        for (let frame = 0; frame < 24; frame++) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          const input = document.querySelector<HTMLInputElement>(
            '[role="dialog"] input',
          );

          if (input) {
            samples.push(
              input.getBoundingClientRect().width / input.offsetWidth,
            );
          }
        }

        return samples;
      });

    expect(scales.length).toBeGreaterThan(0);
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.98);
    expect(Math.max(...scales)).toBeLessThan(1.02);
    await expect(
      page.getByRole("textbox", { name: "Conversation title" }),
    ).toBeFocused();
  });

  test("disclosures can reverse during exit and source exits restore focus", async ({
    page,
  }) => {
    await installConversation(page);
    await page.goto("/c/motion-fixture");
    const toggle = page.getByRole("button", {
      name: "Tool search_knowledge Completed",
      exact: true,
    });

    await toggle.click();
    const content = page.locator('[data-slot="collapsible-content"]').first();

    await expect(content).toBeVisible();
    await expect
      .poll(() =>
        content.evaluate((element) => element.getBoundingClientRect().height),
      )
      .toBeGreaterThan(20);
    await toggle.evaluate((element) => (element as HTMLElement).click());
    await expect(content).toHaveAttribute("inert");
    await expect(content).toHaveAttribute("aria-hidden", "true");
    await toggle.evaluate((element) => (element as HTMLElement).click());
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(content).not.toHaveAttribute("inert");
    await expect
      .poll(() =>
        content.evaluate((element) => element.getBoundingClientRect().height),
      )
      .toBeGreaterThan(20);

    const citation = page.getByRole("button", {
      name: "Source 1: policy.md",
      exact: true,
    });

    await citation.click();
    const reader = page.getByRole("dialog", { name: "Sources", exact: true });

    await expect(reader).toContainText("Returns within 30 days.");
    expect(
      await reader.evaluate(
        (element) => getComputedStyle(element).animationName,
      ),
    ).toBe("sheet-in");
    await reader
      .getByRole("button", { name: "Close sources" })
      .evaluate((element) => (element as HTMLElement).click());
    const exiting = page.locator(
      '[data-slot="sheet-content"][data-state="closed"]',
    );

    await expect(exiting).toHaveCount(1);
    expect(
      await exiting.evaluate(
        (element) => getComputedStyle(element).pointerEvents,
      ),
    ).toBe("none");
    await expect(exiting).toHaveCount(0);
    await expect(citation).toBeFocused();
  });

  test("menus and dialogs share motion timing and restore focus after exit", async ({
    page,
  }) => {
    await installConversation(page);
    await page.goto("/c/motion-fixture");
    const actions = page.getByRole("button", {
      name: "Actions for Motion fixture",
    });

    await actions.click();
    const menu = page.getByRole("menu");

    expect(
      await menu.evaluate((element) => getComputedStyle(element).animationName),
    ).toBe("popup-in");
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const rename = page.getByRole("dialog", { name: "Rename conversation" });

    await expect(rename.getByRole("textbox")).toBeFocused();
    await expect
      .poll(async () => (await rename.boundingBox())!.width)
      .toBeCloseTo(448, 0);
    await page.keyboard.press("Escape");
    await expect(rename).toHaveCount(0);
    await expect(actions).toBeFocused();

    const settingsTrigger = page.getByRole("button", { name: "Open settings" });

    await settingsTrigger.click();
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });

    const viewport = page.viewportSize()!;

    await expect
      .poll(async () => {
        const bounds = (await settings.boundingBox())!;

        return bounds.x + bounds.width / 2;
      })
      .toBeCloseTo(viewport.width / 2, 0);
    await expect
      .poll(async () => {
        const bounds = (await settings.boundingBox())!;

        return bounds.y + bounds.height / 2;
      })
      .toBeCloseTo(viewport.height / 2, 0);
    expect(
      await settings.evaluate(
        (element) => getComputedStyle(element).animationName,
      ),
    ).toBe("popup-in");
    await settings.getByRole("combobox", { name: "Appearance" }).click();
    expect(
      await page
        .getByRole("listbox")
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe("popup-in");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await page.getByRole("button", { name: "Close settings" }).click();
    await expect(settings).toBeHidden();
    await expect(settingsTrigger).toBeFocused();
  });

  test("attachment exit disables its controls and preserves the unsent draft", async ({
    page,
  }) => {
    await page.goto("/");
    const composer = page.getByRole("textbox", { name: "Message" });

    await composer.fill("Keep this unsent draft");
    await page.getByLabel("Choose files").setInputFiles({
      name: "sample.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Fixture"),
    });
    const remove = page.getByRole("button", { name: "Remove sample.txt" });

    await expect(remove).toBeVisible();
    const exiting = await remove.evaluate(async (element) => {
      const chip = element.closest<HTMLElement>(
        '[data-slot="attachment"]',
      )?.parentElement;

      if (!chip) {
        throw new Error("Attachment chip is missing");
      }

      (element as HTMLElement).click();
      await Promise.resolve();

      return { inert: chip.inert, hidden: chip.getAttribute("aria-hidden") };
    });
    const chip = page.locator('[data-slot="attachment"]').locator("..");

    expect(exiting).toEqual({ inert: true, hidden: "true" });
    await expect(chip).toHaveCount(0);
    await expect(composer).toHaveValue("Keep this unsent draft");
    await expect(page).toHaveURL("/");
  });
});

test("reduced motion keeps disclosures and source navigation immediate", async ({
  page,
}) => {
  await installConversation(page);
  await page.goto("/c/motion-fixture");
  const toggle = page.getByRole("button", {
    name: "Tool search_knowledge Completed",
    exact: true,
  });

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page
    .getByRole("button", { name: "Source 1: policy.md", exact: true })
    .click();
  const reader = page.getByRole("dialog", { name: "Sources", exact: true });

  expect(
    await reader.evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  await page.keyboard.press("Escape");
  await expect(reader).toHaveCount(0);
});
