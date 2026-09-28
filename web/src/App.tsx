import { lazy, Suspense } from "react";
import { ConversationApp } from "./ConversationApp";

const GalleryPage = import.meta.env?.DEV
  ? lazy(() =>
      import("./a2ui/GalleryPage").then(({ GalleryPage }) => ({
        default: GalleryPage,
      })),
    )
  : null;

export function App() {
  const path = window.location.pathname;

  if (path === "/") {
    return (
      <>
        <title>Agent Chat · Agent Playground</title>
        <ConversationApp />
      </>
    );
  }

  if (path === "/dev/a2ui-components" && GalleryPage) {
    return (
      <>
        <title>A2UI Components · Agent Playground</title>
        <Suspense
          fallback={
            <div className="min-h-dvh bg-canvas p-8 text-sm text-muted">
              Loading components…
            </div>
          }
        >
          <GalleryPage />
        </Suspense>
      </>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas p-6 text-ink">
      <title>Page Not Found · Agent Playground</title>
      <h1 className="text-lg font-semibold">Page not found</h1>
      <a
        href="/"
        className="rounded-lg px-3 py-2 text-sm text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Open agent chat
      </a>
    </main>
  );
}
