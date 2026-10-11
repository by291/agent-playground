import { useRef, useState, type RefObject } from "react";
import { useReducedMotion } from "motion/react";
import Lightbox, {
  type ControllerRef,
  type SlideImage,
  type ZoomRef,
} from "yet-another-react-lightbox";
import Inline from "yet-another-react-lightbox/plugins/inline";
import Thumbnails from "yet-another-react-lightbox/plugins/thumbnails";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { MagnifyingGlassMinusIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlassMinus";
import { MagnifyingGlassPlusIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlassPlus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import {
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { useImageWheelZoom } from "./useImageWheelZoom";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/thumbnails.css";
import "./image-viewer.css";

export interface AttachmentImage extends SlideImage {
  name: string;
  download?: string | undefined;
}

function ImageViewerControls({
  image,
  index,
  count,
  zoom,
  reducedMotion,
}: {
  image: AttachmentImage;
  index: number;
  count: number;
  zoom: RefObject<ZoomRef | null>;
  reducedMotion: boolean | null;
}) {
  useImageWheelZoom(zoom, image.src, reducedMotion);

  return (
    <div className="image-viewer-header">
      <div className="image-viewer-heading">
        <DialogTitle title={image.name}>{image.name}</DialogTitle>
        <p>
          {index + 1} of {count}
        </p>
      </div>
    </div>
  );
}

export function ImageViewer({
  images,
  initialIndex,
}: {
  images: AttachmentImage[];
  initialIndex: number;
}) {
  return (
    <DialogContent
      aria-describedby={undefined}
      className="attachment-image-viewer fixed top-1/2 left-1/2 z-50 h-dvh w-screen -translate-1/2 overflow-hidden outline-none"
    >
      <ImageViewerContent images={images} initialIndex={initialIndex} />
    </DialogContent>
  );
}

function ImageViewerContent({
  images,
  initialIndex,
}: {
  images: AttachmentImage[];
  initialIndex: number;
}) {
  // Radix Presence mounts this state for each open and retains it through exit.
  // Track image identity so list changes cannot point at a different attachment.
  const [source, setSource] = useState(images[initialIndex]!.src);
  const index = Math.max(
    0,
    images.findIndex((image) => image.src === source),
  );
  const controller = useRef<ControllerRef>(null);
  const zoom = useRef<ZoomRef>(null);
  const reducedMotion = useReducedMotion();
  const current = images[index]!;

  return (
    <Lightbox
      inline={{
        style: { width: "100%", height: "100%" },
        onKeyDownCapture: (event) => {
          // Keep gallery shortcuts available when a toolbar button has focus. The
          // Zoom plugin owns arrow keys while magnified, so they pan the image.
          if (
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            (zoom.current?.zoom ?? 1) > 1
          ) {
            return;
          }

          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            event.stopPropagation();

            if (event.key === "ArrowLeft") {
              controller.current?.prev();
            } else {
              controller.current?.next();
            }
          }
        },
      }}
      index={index}
      slides={images}
      plugins={images.length > 1 ? [Inline, Zoom, Thumbnails] : [Inline, Zoom]}
      controller={{ ref: controller, aria: false }}
      carousel={{ finite: true, preload: 1, padding: "32px" }}
      zoom={{
        ref: zoom,
        scrollToZoom: true,
        doubleClickMaxStops: 1,
        // Small screenshots still need magnification when they fit at native size.
        maxZoomPixelRatio: 4,
      }}
      animation={{
        fade: 0,
        swipe: reducedMotion ? 0 : 220,
        navigation: reducedMotion ? 0 : 180,
        zoom: reducedMotion ? 0 : 180,
      }}
      thumbnails={{
        width: 56,
        height: 44,
        gap: 8,
        padding: 0,
        borderRadius: 6,
      }}
      labels={{ Previous: "Previous image", Next: "Next image" }}
      on={{ view: ({ index: nextIndex }) => setSource(images[nextIndex]!.src) }}
      toolbar={{
        buttons: [
          "zoom",
          current.download && (
            <a
              key="download"
              className="yarl__button"
              href={current.download}
              download={current.name}
              aria-label="Download original"
              title="Download original"
            >
              <DownloadSimpleIcon size={22} aria-hidden="true" />
            </a>
          ),
          <DialogClose key="close" asChild>
            <button
              type="button"
              className="yarl__button"
              aria-label="Close dialog"
              title="Close image preview"
            >
              <XIcon size={22} aria-hidden="true" />
            </button>
          </DialogClose>,
        ],
      }}
      render={{
        controls: () => (
          <ImageViewerControls
            image={current}
            index={index}
            count={images.length}
            zoom={zoom}
            reducedMotion={reducedMotion}
          />
        ),
        buttonZoom: ({
          zoom: level,
          minZoom,
          maxZoom,
          disabled,
          zoomIn,
          zoomOut,
          changeZoom,
        }) => (
          <>
            <button
              type="button"
              className="yarl__button"
              aria-label="Zoom out"
              title="Zoom out"
              disabled={disabled}
              aria-disabled={level <= minZoom}
              onClick={() => zoomOut()}
            >
              <MagnifyingGlassMinusIcon size={22} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="yarl__button image-viewer-fit"
              aria-label="Fit image to screen"
              title="Fit image to screen"
              disabled={disabled}
              aria-disabled={level === minZoom}
              onClick={() => changeZoom(minZoom)}
            >
              {level === minZoom ? "Fit" : `${Math.round(level * 100)}%`}
            </button>
            <button
              type="button"
              className="yarl__button"
              aria-label="Zoom in"
              title="Zoom in"
              disabled={disabled}
              aria-disabled={level >= maxZoom}
              onClick={() => zoomIn()}
            >
              <MagnifyingGlassPlusIcon size={22} aria-hidden="true" />
            </button>
          </>
        ),
        ...(images.length === 1
          ? { buttonPrev: () => null, buttonNext: () => null }
          : {}),
        iconPrev: () => <ArrowLeftIcon size={24} aria-hidden="true" />,
        iconNext: () => <ArrowRightIcon size={24} aria-hidden="true" />,
        iconError: () => (
          <p role="status" className="image-viewer-error">
            Image preview is unavailable.
          </p>
        ),
      }}
    />
  );
}
