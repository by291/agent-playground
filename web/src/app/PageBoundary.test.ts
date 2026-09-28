// @vitest-environment jsdom
import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { PageBoundary } from "./PageBoundary";

test("a page render failure shows a reload action instead of a blank page", () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  function FailedPage(): never {
    throw new Error("Page module failed");
  }

  const page = render(
    createElement(PageBoundary, { children: createElement(FailedPage) }),
  );

  assert.ok(page.getByRole("heading", { name: "Could not load this page" }));
  assert.equal(
    page.getByRole("link", { name: "Reload page" }).getAttribute("href"),
    "/",
  );
});
