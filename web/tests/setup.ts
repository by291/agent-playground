import { afterEach, vi } from "vitest";

let cleanupDom: (() => void) | undefined;

if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react/pure");

  await import("@testing-library/jest-dom/vitest");
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  cleanupDom = () => {
    cleanup();
    window.localStorage.clear();
  };
}

afterEach(() => {
  cleanupDom?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
