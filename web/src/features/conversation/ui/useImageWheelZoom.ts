import { useEffect, type RefObject } from "react";
import { useController, type ZoomRef } from "yet-another-react-lightbox";

export function useImageWheelZoom(
  zoom: RefObject<ZoomRef | null>,
  source: string,
  reducedMotion: boolean | null,
) {
  const { containerRef } = useController();

  useEffect(() => {
    const container = containerRef.current;
    const viewportWindow = container?.ownerDocument.defaultView;

    if (!container || !viewportWindow) {
      return;
    }

    let frame: number | undefined;
    let target: number | undefined;
    let displayed = 1;
    let previousTime = 0;
    let direction = 0;
    let anchorX = 0;
    let anchorY = 0;

    const cancel = () => {
      if (frame !== undefined) {
        viewportWindow.cancelAnimationFrame(frame);
      }

      frame = undefined;
      target = undefined;
      direction = 0;
    };

    const advance = (time: number) => {
      frame = undefined;
      const current = zoom.current;

      if (!current || current.disabled || target === undefined) {
        cancel();

        return;
      }

      // Time-based interpolation keeps the response consistent across refresh
      // rates. The lightbox retains image bounds and cursor anchoring.
      const elapsed = Math.min(time - previousTime, 64);
      const next =
        displayed + (target - displayed) * (1 - Math.exp(-elapsed / 50));

      previousTime = time;
      displayed = Math.abs(target - next) < 0.001 ? target : next;
      current.changeZoom(displayed, true, anchorX, anchorY);

      if (displayed !== target) {
        frame = viewportWindow.requestAnimationFrame(advance);
      }
    };

    const onWheel = (event: WheelEvent) => {
      const current = zoom.current;

      if (
        !current ||
        current.disabled ||
        Math.abs(event.deltaY) <= Math.abs(event.deltaX)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const bounds = container.getBoundingClientRect();
      let pixels = event.deltaY;

      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        pixels *= 16;
      } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        pixels *= bounds.height;
      }

      const nextDirection = Math.sign(pixels);
      const reversing = direction !== 0 && nextDirection !== direction;
      const startingZoom = reversing ? current.zoom : (target ?? current.zoom);
      const boundedDelta = Math.max(-240, Math.min(pixels, 240));

      target = Math.max(
        current.minZoom,
        Math.min(startingZoom * Math.exp(-boundedDelta / 600), current.maxZoom),
      );
      direction = nextDirection;
      anchorX = event.clientX - bounds.left - bounds.width / 2;
      anchorY = event.clientY - bounds.top - bounds.height / 2;

      if (reducedMotion) {
        current.changeZoom(target, true, anchorX, anchorY);

        return;
      }

      if (frame === undefined || reversing) {
        displayed = current.zoom;
        previousTime = viewportWindow.performance.now();
      }

      frame ??= viewportWindow.requestAnimationFrame(advance);
    };

    // Own only wheel interpolation. Direct input cancels pending frames before
    // the lightbox handles drag, reset, or navigation, including click-only
    // activation from assistive controls.
    container.addEventListener("wheel", onWheel, {
      passive: false,
      capture: true,
    });
    container.addEventListener("pointerdown", cancel, true);
    container.addEventListener("keydown", cancel, true);
    container.addEventListener("click", cancel, true);

    return () => {
      cancel();
      container.removeEventListener("wheel", onWheel, true);
      container.removeEventListener("pointerdown", cancel, true);
      container.removeEventListener("keydown", cancel, true);
      container.removeEventListener("click", cancel, true);
    };
  }, [containerRef, zoom, source, reducedMotion]);
}
