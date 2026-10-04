// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { createElement } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { UserPreferencesProvider, useUserPreferences } from "./preferences";

function PreferenceControls() {
  const { preferences, updatePreferences, saved } = useUserPreferences();

  return createElement("button", {
    onClick: () => updatePreferences({ theme: "dark", replyAnimation: false }),
    children: `${preferences.theme}:${preferences.replyAnimation}:${saved}`,
  });
}

test("preferences still apply when storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  const page = render(
    createElement(UserPreferencesProvider, {
      children: createElement(PreferenceControls),
    }),
  );

  fireEvent.click(page.getByRole("button"));
  expect(page.getByRole("button")).toHaveTextContent("dark:false:false");
  expect(document.documentElement).toHaveClass("dark");
});

test("system appearance follows changes and unmount releases its media subscription", () => {
  let matches = false;
  const media = new EventTarget();
  const remove = vi.spyOn(media, "removeEventListener");

  Object.defineProperty(media, "matches", { get: () => matches });
  vi.stubGlobal("matchMedia", () => media);
  localStorage.setItem("agent-playground-preferences", '{"theme":"system"}');
  const page = render(
    createElement(UserPreferencesProvider, {
      children: createElement(PreferenceControls),
    }),
  );

  expect(document.documentElement).not.toHaveClass("dark");
  act(() => {
    matches = true;
    media.dispatchEvent(new Event("change"));
  });
  expect(document.documentElement).toHaveClass("dark");
  page.unmount();
  expect(remove).toHaveBeenCalledWith("change", expect.any(Function));
  expect(document.documentElement).not.toHaveClass("dark");
});
