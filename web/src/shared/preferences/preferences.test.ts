import { expect, test } from "vitest";
import { parseUserPreferences } from "./preferences";

test("preferences preserve existing defaults and recover from damaged storage", () => {
  const defaults = {
    theme: "light",
    sendShortcut: "enter",
    replyAnimation: true,
  };

  expect(parseUserPreferences(null)).toEqual(defaults);
  expect(parseUserPreferences("broken JSON")).toEqual(defaults);
  expect(parseUserPreferences('{"theme":"unknown"}')).toEqual(defaults);
});

test("saved preferences validate their values and fill missing options", () => {
  expect(parseUserPreferences('{"theme":"system"}')).toEqual({
    theme: "system",
    sendShortcut: "enter",
    replyAnimation: true,
  });
  expect(
    parseUserPreferences(
      JSON.stringify({
        theme: "dark",
        sendShortcut: "modifier-enter",
        replyAnimation: false,
      }),
    ),
  ).toEqual({
    theme: "dark",
    sendShortcut: "modifier-enter",
    replyAnimation: false,
  });
});
