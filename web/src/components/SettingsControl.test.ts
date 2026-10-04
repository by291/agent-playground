// @vitest-environment jsdom
import { createElement } from "react";
import { fireEvent, render, within, waitFor } from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";
import { SettingsControl } from "./SettingsControl";
import { UserPreferencesProvider } from "@/lib/preferences";

test("a rejected clear displays the error, keeps settings open and permits an explicit retry", async () => {
  // jsdom has no native modal implementation; browser tests own focus and stacking.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = false;
        this.dispatchEvent(new Event("close"));
      },
    },
  });
  onTestFinished(() => {
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  });
  const clear = vi
    .fn()
    .mockRejectedValueOnce(new Error("Wait for the run to finish"))
    .mockResolvedValueOnce(undefined);
  const page = render(
    createElement(UserPreferencesProvider, {
      children: createElement(SettingsControl, { onClearConversations: clear }),
    }),
  );

  fireEvent.click(page.getByRole("button", { name: "Open settings" }));
  fireEvent.click(
    page.getByRole("button", { name: "Clear all conversations" }),
  );
  const confirmation = page.getByRole("alertdialog");
  const confirm = within(confirmation).getByRole("button", {
    name: "Delete all conversations",
  });

  fireEvent.click(confirm);
  expect(await page.findByRole("alert")).toHaveTextContent(
    "Wait for the run to finish",
  );
  expect(confirm).toBeEnabled();
  expect(confirmation).toHaveAttribute("open");
  fireEvent.click(confirm);
  await waitFor(() => expect(confirmation).not.toHaveAttribute("open"));
  expect(page.getByRole("dialog", { name: "Settings" })).toHaveAttribute(
    "open",
  );
  expect(clear).toHaveBeenCalledTimes(2);
});
