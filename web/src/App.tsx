import { lazy, Suspense } from "react";

const GalleryPage = lazy(() =>
  import("./a2ui/GalleryPage").then(({ GalleryPage }) => ({
    default: GalleryPage,
  })),
);

const ConversationApp = lazy(() =>
  import("./ConversationApp").then(({ ConversationApp }) => ({
    default: ConversationApp,
  })),
);

export function App() {
  const isGallery = window.location.pathname === "/a2ui";
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-canvas p-8 text-sm text-muted">
          {isGallery ? "Loading components…" : "Loading conversation…"}
        </div>
      }
    >
      {isGallery ? <GalleryPage /> : <ConversationApp />}
    </Suspense>
  );
}
