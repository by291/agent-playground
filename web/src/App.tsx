import { lazy, Suspense } from "react";
import { ConversationApp } from "./ConversationApp";

const GalleryPage = lazy(() =>
  import("./a2ui/GalleryPage").then(({ GalleryPage }) => ({
    default: GalleryPage,
  })),
);

export function App() {
  const isGallery = window.location.pathname === "/a2ui";

  if (!isGallery) {
    return <ConversationApp />;
  }

  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-canvas p-8 text-sm text-muted">
          Loading components…
        </div>
      }
    >
      <GalleryPage />
    </Suspense>
  );
}
