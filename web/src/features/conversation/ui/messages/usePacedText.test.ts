// @vitest-environment jsdom
import { test } from "vitest";
import assert from "node:assert/strict";
import { renderHook } from "@testing-library/react";
import { usePacedText } from "./usePacedText";
import { animationClock } from "../../../../../tests/animationClock";

test("even a large final burst drains within three seconds after the model finishes", () => {
  const clock = animationClock();
  const text = "城市中的日常生活。".repeat(1000);
  const hook = renderHook(
    ({ text, streaming }) => usePacedText(text, streaming),
    { initialProps: { text, streaming: true } },
  );

  clock.advance(340);
  hook.rerender({ text, streaming: false });
  clock.advance(3000);

  assert.equal(hook.result.current.text.length, text.length);
  assert.equal(clock.frames.size, 0);
});

test("many source chunks in one frame do not bypass the display cadence", () => {
  const clock = animationClock();
  const hook = renderHook(({ text }) => usePacedText(text, true), {
    initialProps: { text: "" },
  });

  for (let chunk = 1; chunk <= 100; chunk++) {
    hook.rerender({ text: "中".repeat(chunk * 10) });
  }

  assert.equal(hook.result.current.text, "");
  clock.advance(34);
  const prefix = hook.result.current.text;

  assert.ok(prefix.length > 0 && prefix.length < 30);
  hook.unmount();
  assert.equal(clock.frames.size, 0);
});
