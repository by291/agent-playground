// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { PointerEvent } from "react";
import { usePanelWidth } from "./usePanelWidth";

test("overlapping panel drags release body styles and unmount releases an active drag", () => {
  const target = document.createElement("div");

  target.setPointerCapture = vi.fn();
  const pointer = (pointerId: number) =>
    ({
      button: 0,
      pointerId,
      clientX: 100,
      currentTarget: target,
      preventDefault: vi.fn(),
    }) as unknown as PointerEvent<HTMLDivElement>;
  const panels = renderHook(() => ({
    left: usePanelWidth({
      storageKey: "left-test",
      defaultWidth: 320,
      minimumWidth: 240,
      maximumWidth: 420,
      side: "left",
    }),
    right: usePanelWidth({
      storageKey: "right-test",
      defaultWidth: 520,
      minimumWidth: 400,
      maximumWidth: 720,
      side: "right",
    }),
  }));
  const originalCursor = document.body.style.cursor;
  const originalSelection = document.body.style.userSelect;

  act(() => panels.result.current.left.handleProps.onPointerDown(pointer(1)));
  act(() => panels.result.current.right.handleProps.onPointerDown(pointer(2)));
  expect(document.body.style.cursor).toBe("col-resize");
  act(() => panels.result.current.left.handleProps.onPointerUp());
  act(() => panels.result.current.right.handleProps.onPointerUp());
  expect(document.body.style.cursor).toBe(originalCursor);
  expect(document.body.style.userSelect).toBe(originalSelection);
  act(() => panels.result.current.right.handleProps.onPointerDown(pointer(3)));
  expect(document.body.style.cursor).toBe("col-resize");
  panels.unmount();
  expect(document.body.style.cursor).toBe(originalCursor);
  expect(document.body.style.userSelect).toBe(originalSelection);
});
