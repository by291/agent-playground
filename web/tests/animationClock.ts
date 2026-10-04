import { act } from "@testing-library/react";
import { vi } from "vitest";

export function animationClock() {
  let now = 0;
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++nextId;

    frames.set(id, callback);

    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));

  return {
    frames,
    advance(duration: number) {
      const end = now + duration;

      while (now < end) {
        const elapsed = Math.min(end - now, 34);

        now += elapsed;
        const pending = [...frames.values()];

        frames.clear();
        act(() => {
          vi.advanceTimersByTime(elapsed);

          for (const callback of pending) {
            callback(now);
          }
        });
      }
    },
  };
}
