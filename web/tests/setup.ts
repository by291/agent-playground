import { afterEach, vi } from "vitest";
import { MotionGlobalConfig } from "motion/react";

let cleanupDom: (() => void) | undefined;

if (typeof document !== "undefined") {
  // Browser regression tests exercise motion; DOM tests exercise state changes.
  MotionGlobalConfig.skipAnimations = true;
  const { cleanup } = await import("@testing-library/react/pure");

  await import("@testing-library/jest-dom/vitest");
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // Browser tests verify scrolling; jsdom needs a stable implementation for hooks.
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: () => undefined,
  });
  window.scrollTo = () => undefined;
  cleanupDom = () => {
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.documentElement.removeAttribute("class");
    document.documentElement.removeAttribute("style");
    document.body.removeAttribute("style");
  };
}

afterEach(() => {
  cleanupDom?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
