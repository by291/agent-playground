import { test } from "vitest";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewPanel } from "./ReviewPanel";

const review = {
  interruptId: "review",
  title: "Plan",
  steps: ["Run a trial."],
};

test("a single plan exposes direct approval and rejection beside editable fields", () => {
  const markup = renderToStaticMarkup(
    createElement(ReviewPanel, {
      reviews: [review],
      running: false,
      onReview: () => Promise.resolve(),
    }),
  );

  assert.doesNotMatch(markup, /role="radiogroup"/);
  assert.equal((markup.match(/<button\b/g) ?? []).length, 2);
  assert.match(markup, /<input[^>]*value="Plan"/);
  assert.match(markup, /<textarea[^>]*>Run a trial\./);
});

test("an empty plan cannot be approved but can still be rejected", () => {
  const markup = renderToStaticMarkup(
    createElement(ReviewPanel, {
      reviews: [{ ...review, title: "", steps: [] }],
      running: false,
      onReview: () => Promise.resolve(),
    }),
  );

  assert.match(markup, /<button[^>]*type="submit"[^>]*disabled=""/);
  assert.match(markup, /<button[^>]*type="button"(?![^>]*disabled)[^>]*>/);
});
