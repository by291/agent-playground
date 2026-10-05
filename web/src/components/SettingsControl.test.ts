// @vitest-environment jsdom
import { createElement } from "react";
import { act, render, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { SettingsControl, SettingsProvider } from "./SettingsControl";
import { UserPreferencesProvider } from "@/lib/preferences";

test("a rejected clear displays the error, keeps settings open and permits an explicit retry", async () => {
  const user = userEvent.setup();
  const clear = vi
    .fn()
    .mockRejectedValueOnce(new Error("Wait for the run to finish"))
    .mockResolvedValueOnce(undefined);
  const page = render(
    createElement(UserPreferencesProvider, {
      children: createElement(SettingsControl, { onClearConversations: clear }),
    }),
  );

  await user.click(page.getByRole("button", { name: "Open settings" }));
  const settings = page.getByRole("dialog", { name: "Settings" });
  const trigger = within(settings).getByRole("button", {
    name: "Clear all conversations",
  });

  await user.click(trigger);
  const confirmation = page.getByRole("alertdialog", {
    name: "Clear all conversations?",
  });
  const confirm = within(confirmation).getByRole("button", {
    name: "Delete all conversations",
  });

  await user.click(confirm);
  expect(await page.findByRole("alert")).toHaveTextContent(
    "Wait for the run to finish",
  );
  expect(confirm).toBeEnabled();
  expect(confirmation).toBeVisible();
  await user.click(confirm);
  await waitFor(() => expect(confirmation).not.toBeInTheDocument());
  expect(settings).toBeVisible();
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(clear).toHaveBeenCalledTimes(2);
});

test("clearing locks both dialog layers until the request completes", async () => {
  const user = userEvent.setup();
  let complete: () => void = () => undefined;
  const clear = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const page = render(
    createElement(SettingsControl, { onClearConversations: clear }),
  );

  await user.click(page.getByRole("button", { name: "Open settings" }));
  const settings = page.getByRole("dialog", { name: "Settings" });

  await user.click(
    within(settings).getByRole("button", { name: "Clear all conversations" }),
  );
  const confirmation = page.getByRole("alertdialog");

  await user.click(
    within(confirmation).getByRole("button", {
      name: "Delete all conversations",
    }),
  );
  expect(
    within(confirmation).getByRole("button", { name: "Clearing…" }),
  ).toBeDisabled();
  expect(
    within(confirmation).getByRole("button", { name: "Cancel" }),
  ).toBeDisabled();
  await user.keyboard("{Escape}{Escape}");
  expect(confirmation).toBeVisible();
  expect(settings).toBeVisible();
  expect(clear).toHaveBeenCalledOnce();
  await act(() => Promise.resolve(complete()));
  await waitFor(() => expect(confirmation).not.toBeInTheDocument());
  expect(settings).toBeVisible();
});

test("reply animation is a persisted switch and resetting preferences restores it", async () => {
  const user = userEvent.setup();
  const page = render(
    createElement(UserPreferencesProvider, {
      children: createElement(SettingsControl),
    }),
  );

  await user.click(page.getByRole("button", { name: "Open settings" }));
  const animation = page.getByRole("switch", { name: "Reply animation" });

  expect(animation).toBeChecked();
  await user.click(animation);
  expect(animation).not.toBeChecked();
  expect(
    JSON.parse(localStorage.getItem("agent-playground-preferences") ?? "{}"),
  ).toMatchObject({ replyAnimation: false });
  await user.click(page.getByRole("button", { name: "Reset preferences" }));
  expect(animation).toBeChecked();
});

test("shared settings return focus to the opening control and preserve an outside draft", async () => {
  const user = userEvent.setup();
  const page = render(
    createElement(SettingsProvider, {
      children: createElement(
        "div",
        null,
        createElement("textarea", { "aria-label": "Message" }),
        createElement(SettingsControl),
        createElement(SettingsControl),
      ),
    }),
  );
  const draft = page.getByRole("textbox", { name: "Message" });
  const trigger = page.getAllByRole("button", { name: "Open settings" })[1]!;

  await user.type(draft, "Keep this draft.");
  await user.click(trigger);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(page.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(draft).toHaveValue("Keep this draft.");
});

test("closing settings restores a visible navigation trigger when its opener is removed", async () => {
  const user = userEvent.setup();
  const element = (showSettingsTrigger: boolean) =>
    createElement(SettingsProvider, {
      children: createElement(
        "div",
        null,
        createElement("button", {
          id: "workspace-sidebar-trigger",
          style: { display: "none" },
          "aria-label": "Desktop navigation",
        }),
        createElement("button", {
          id: "workspace-navigation-trigger",
          "aria-label": "Mobile navigation",
        }),
        showSettingsTrigger ? createElement(SettingsControl) : null,
      ),
    });
  const page = render(element(true));

  await user.click(page.getByRole("button", { name: "Open settings" }));
  page.rerender(element(false));
  expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await user.click(page.getByRole("button", { name: "Done" }));
  await waitFor(() =>
    expect(
      page.getByRole("button", { name: "Mobile navigation" }),
    ).toHaveFocus(),
  );
});
