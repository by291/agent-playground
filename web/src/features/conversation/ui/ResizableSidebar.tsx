import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Sidebar } from "./Sidebar";

const storageKey = "agent-playground-sidebar-width";
const minimumWidth = 240;
const maximumWidth = 420;
const defaultWidth = 320;

function clampWidth(width: number) {
  return Math.min(maximumWidth, Math.max(minimumWidth, Math.round(width)));
}

function loadWidth() {
  try {
    const saved = localStorage.getItem(storageKey);
    const width = Number(saved);

    if (saved !== null && Number.isFinite(width)) {
      return clampWidth(width);
    }
  } catch {
    // Layout preferences are optional when browser storage is unavailable.
  }

  return defaultWidth;
}

function saveWidth(width: number) {
  try {
    localStorage.setItem(storageKey, String(width));
  } catch {
    // The current layout still works without saving the preference.
  }
}

export function ResizableSidebar({
  collapsed,
  empty,
  onNewConversation,
}: {
  collapsed: boolean;
  empty: boolean;
  onNewConversation: () => void;
}) {
  const [width, setWidth] = useState(loadWidth);
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    if (!resizing) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelection;
    };
  }, [resizing]);

  function startResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
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
      current.startWidth + event.clientX - current.startX,
    );
    setWidth(current.width);
  }

  function finishResize() {
    if (!drag.current) {
      return;
    }

    saveWidth(drag.current.width);
    drag.current = null;
    setResizing(false);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    let nextWidth = width;

    if (event.key === "ArrowLeft") {
      nextWidth -= 16;
    } else if (event.key === "ArrowRight") {
      nextWidth += 16;
    } else if (event.key === "Home") {
      nextWidth = minimumWidth;
    } else if (event.key === "End") {
      nextWidth = maximumWidth;
    } else {
      return;
    }

    event.preventDefault();
    const next = clampWidth(nextWidth);

    setWidth(next);
    saveWidth(next);
  }

  return (
    <div
      className="workspace-sidebar-shell relative hidden h-full shrink-0 md:block"
      data-resizing={resizing}
      style={{ width: collapsed ? 64 : width }}
    >
      <Sidebar
        collapsed={collapsed}
        empty={empty}
        onNewConversation={onNewConversation}
      />
      {!collapsed && (
        <div
          role="separator"
          tabIndex={0}
          aria-label="Sidebar width"
          aria-orientation="vertical"
          aria-controls="workspace-sidebar"
          aria-valuemin={minimumWidth}
          aria-valuemax={maximumWidth}
          aria-valuenow={width}
          aria-valuetext={`${width} pixels`}
          title="Drag to resize. Use arrow keys to adjust width."
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onLostPointerCapture={finishResize}
          onKeyDown={resizeWithKeyboard}
          className="group absolute inset-y-0 -right-3 z-10 w-6 touch-none cursor-col-resize focus-visible:outline-none"
        >
          <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-accent opacity-0 group-hover:opacity-60 group-focus-visible:opacity-100" />
        </div>
      )}
    </div>
  );
}
