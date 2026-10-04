import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

interface PanelWidthOptions {
  storageKey: string;
  minimumWidth: number;
  maximumWidth: number;
  defaultWidth: number;
  side: "left" | "right";
}

let activeResize = false;

function clampWidth(width: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.round(width)));
}

function loadWidth(options: PanelWidthOptions) {
  try {
    const saved = localStorage.getItem(options.storageKey);
    const width = Number(saved);

    if (saved !== null && Number.isFinite(width)) {
      return clampWidth(width, options.minimumWidth, options.maximumWidth);
    }
  } catch {
    // Layout preferences are optional when browser storage is unavailable.
  }

  return options.defaultWidth;
}

export function usePanelWidth({
  storageKey,
  minimumWidth,
  maximumWidth,
  defaultWidth,
  side,
}: PanelWidthOptions) {
  const [width, setWidth] = useState(() =>
    loadWidth({ storageKey, minimumWidth, maximumWidth, defaultWidth, side }),
  );
  const [resizing, setResizing] = useState(false);
  const direction = side === "left" ? 1 : -1;
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    width: number;
  } | null>(null);
  const releaseDrag = useRef<(() => void) | null>(null);

  useEffect(() => () => releaseDrag.current?.(), []);

  function saveWidth(nextWidth: number) {
    try {
      localStorage.setItem(storageKey, String(nextWidth));
    } catch {
      // The current layout still works without saving the preference.
    }
  }

  function startResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || drag.current || activeResize) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeResize = true;
    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    releaseDrag.current = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelection;
      activeResize = false;
    };
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
      width,
    };
    setResizing(true);
  }

  function moveResize(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;

    if (current?.pointerId !== event.pointerId) {
      return;
    }

    current.width = clampWidth(
      current.startWidth + direction * (event.clientX - current.startX),
      minimumWidth,
      maximumWidth,
    );
    setWidth(current.width);
  }

  function finishResize() {
    if (!drag.current) {
      return;
    }

    saveWidth(drag.current.width);
    drag.current = null;
    releaseDrag.current?.();
    releaseDrag.current = null;
    setResizing(false);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    let nextWidth = width;

    if (event.key === "ArrowLeft") {
      nextWidth -= 16 * direction;
    } else if (event.key === "ArrowRight") {
      nextWidth += 16 * direction;
    } else if (event.key === "Home") {
      nextWidth = minimumWidth;
    } else if (event.key === "End") {
      nextWidth = maximumWidth;
    } else {
      return;
    }

    event.preventDefault();
    const next = clampWidth(nextWidth, minimumWidth, maximumWidth);

    setWidth(next);
    saveWidth(next);
  }

  return {
    width,
    resizing,
    handleProps: {
      role: "separator" as const,
      tabIndex: 0,
      "aria-orientation": "vertical" as const,
      "aria-valuemin": minimumWidth,
      "aria-valuemax": maximumWidth,
      "aria-valuenow": width,
      "aria-valuetext": `${width} pixels`,
      title: "Drag to resize. Use arrow keys to adjust width.",
      onPointerDown: startResize,
      onPointerMove: moveResize,
      onPointerUp: finishResize,
      onPointerCancel: finishResize,
      onLostPointerCapture: finishResize,
      onKeyDown: resizeWithKeyboard,
    },
  };
}
