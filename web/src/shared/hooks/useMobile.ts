import { useMediaQuery } from "./useMediaQuery";

/** Tracks the breakpoint shared by mobile navigation controls. */
export function useIsMobile() {
  return useMediaQuery("(max-width: 767px)");
}
