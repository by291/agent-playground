import { useState } from "react";

export function useStoredPanelSize(
  key: string,
  initial: number,
  minimum: number,
  maximum: number,
) {
  const [size, setSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key));

      return saved >= minimum && saved <= maximum ? saved : initial;
    } catch {
      return initial;
    }
  });

  function saveSize(pixels: number) {
    const next = Math.min(maximum, Math.max(minimum, pixels));

    setSize(next);

    try {
      localStorage.setItem(key, String(next));
    } catch {
      // Resizing does not depend on persistent browser preferences.
    }
  }

  return { size, saveSize };
}

export function panelPixels(group: HTMLDivElement | null, percentage: number) {
  if (!group) {
    return 0;
  }

  // Persist the requested layout, not an intermediate width during CSS motion.
  const separators = Array.from(group.children).filter((child) =>
    child.hasAttribute("data-separator"),
  );
  const separatorWidth = separators.reduce(
    (width, child) => width + (child as HTMLElement).offsetWidth,
    0,
  );

  return ((group.clientWidth - separatorWidth) * percentage) / 100;
}
