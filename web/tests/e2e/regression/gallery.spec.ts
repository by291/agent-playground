import { expect, test } from "../fixtures";
import { verifyGallerySelection } from "../flows";

const galleryTest = test.extend<{ editorErrors: string[] }>({
  editorErrors: [
    async ({ page }, runTest) => {
      const errors: string[] = [];

      function recordError(error: Error) {
        errors.push(error.message);
      }

      page.on("pageerror", recordError);

      try {
        // Cold Vite transforms and local Monaco initialization belong to setup.
        // The body then exercises replacement of an initialized editor.
        await page.goto("/dev/a2ui-components");
        await expect(
          page.getByRole("textbox", {
            name: "WorkflowPanel JSON editor",
            exact: true,
          }),
        ).toBeVisible({ timeout: 30_000 });
        await runTest(errors);
      } finally {
        page.off("pageerror", recordError);
      }
    },
    { timeout: 45_000 },
  ],
});

galleryTest(
  "the development gallery selects a valid WorkflowText preview",
  async ({ page, editorErrors }) => {
    await verifyGallerySelection(page);
    const editor = page.getByRole("textbox", {
      name: "WorkflowText JSON editor",
    });

    await expect(editor).toBeVisible();
    await editor.press("ControlOrMeta+End");
    await editor.press("ArrowUp");
    await expect(
      page.getByRole("heading", { name: "A clear heading", exact: true }),
    ).toBeVisible();
    await editor.press("ControlOrMeta+A");
    await page.keyboard.insertText("{");
    await expect(
      page.getByRole("alert").filter({ hasText: "Enter valid JSON" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "A clear heading", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Valid A2UI JSON" }),
    ).toBeVisible();
    await expect(editor).toBeVisible();
    expect(editorErrors).toEqual([]);
  },
);

test.describe("Select positioning during motion", () => {
  test.use({ reducedMotion: "no-preference" });

  for (const side of ["bottom", "top"] as const) {
    test(`the ${side} menu keeps its bounds when its entrance finishes`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/dev/a2ui-components");
      const trigger = page.getByRole("combobox", {
        name: "Component",
        exact: true,
      });

      await expect(trigger).toBeVisible();
      await page.addStyleTag({
        // Pause from creation so runner delays cannot consume the animation.
        content:
          '[data-slot="select-content"][data-state="open"] { animation-play-state: paused !important; }',
      });

      if (side === "top") {
        await trigger.evaluate((element) => {
          element.style.position = "fixed";
          element.style.bottom = "10px";
          element.style.left = "20px";
        });
      }

      await trigger.evaluate((element) => (element as HTMLElement).click());
      const menu = page.getByRole("listbox");

      await expect(menu).toHaveAttribute("data-side", side);
      // Radix suppresses the entrance animation until Popper has placed the menu.
      await expect
        .poll(() => menu.evaluate((element) => element.getAnimations().length))
        .toBe(1);
      const shift = await menu.evaluate((element) => {
        const animation = element.getAnimations()[0];

        if (!animation?.effect) {
          throw new Error("Select entrance animation did not start");
        }

        animation.pause();
        animation.currentTime =
          Number(animation.effect.getTiming().duration) - 0.1;
        const before = element.getBoundingClientRect();

        animation.finish();
        const after = element.getBoundingClientRect();

        return Math.max(
          Math.abs(after.x - before.x),
          Math.abs(after.y - before.y),
          Math.abs(after.width - before.width),
          Math.abs(after.height - before.height),
        );
      });

      expect(shift).toBeLessThan(0.5);
      await page
        .getByRole("option", { name: "WorkflowText", exact: true })
        .click();
      await expect(trigger).toHaveText("WorkflowText");
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }
});
