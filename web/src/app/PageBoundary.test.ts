import "../../tests/dom";
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { PageBoundary } from "./PageBoundary";

afterEach(cleanup);

void test("a page render failure shows a reload action instead of a blank page", (context) => {
  context.mock.method(console, "error", () => undefined);

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
