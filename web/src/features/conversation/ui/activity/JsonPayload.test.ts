// @vitest-environment jsdom
import { test, expect } from "vitest";
import { createElement } from "react";
import { render, waitFor } from "@testing-library/react";
import { JsonPayload } from "./JsonPayload";

test("JSON highlighting preserves every character and renders HTML-like values as text", async () => {
  const event = {
    type: "CUSTOM",
    value: {
      text: '<img src="x" onerror="alert(1)">\n```\nquoted "text"',
      enabled: true,
      count: 12.5,
      missing: null,
    },
  };
  const source = JSON.stringify(event, null, 2);
  const page = render(createElement(JsonPayload, { source }));
  const payload = page.getByLabelText("Event payload");

  expect(payload.textContent).toBe(source);
  expect(payload.querySelector("img")).toBeNull();
  await waitFor(() => {
    const tokens = [...payload.querySelectorAll<HTMLElement>("span[style]")];

    expect(tokens.length).toBeGreaterThan(0);
    expect(
      new Set(
        tokens.map((token) => token.style.getPropertyValue("--json-light")),
      ).size,
    ).toBeGreaterThan(1);
    expect(
      tokens.every((token) => token.style.getPropertyValue("--json-dark")),
    ).toBe(true);
  });
  expect(payload.textContent).toBe(source);
  page.rerender(createElement(JsonPayload, { source: '{"changed": true}' }));
  expect(payload.textContent).toBe('{"changed": true}');
  await waitFor(() =>
    expect(payload.querySelector("span[style]")).not.toBeNull(),
  );
  expect(payload.textContent).toBe('{"changed": true}');
});
