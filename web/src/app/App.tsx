import { lazy, Suspense } from "react";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { ChatPage } from "@/pages/chat/ChatPage";
import { appConfig } from "./config";
import { PageBoundary } from "./PageBoundary";

// Keep the development import behind Vite's compile-time flag.
const ComponentsPage = import.meta.env?.DEV
  ? lazy(() =>
      import("@/pages/dev/a2ui-components/ComponentsPage").then(
        ({ ComponentsPage }) => ({
          default: ComponentsPage,
        }),
      ),
    )
  : null;

export function App() {
  return (
    <PageBoundary>
      <CurrentPage />
    </PageBoundary>
  );
}

function CurrentPage() {
  const path = window.location.pathname;

  if (path === "/") {
    return (
      <>
        <title>Agent Chat · Agent Playground</title>
        <ChatPage development={appConfig.development} />
      </>
    );
  }

  if (path === "/dev/a2ui-components" && ComponentsPage) {
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
          <ComponentsPage />
        </Suspense>
      </>
    );
  }

  return <NotFoundPage />;
}
