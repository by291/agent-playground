import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { lazy, Suspense } from "react";
import { NotFoundPage } from "@/pages/not-found/NotFoundPage";
import { ChatPage } from "@/pages/chat/ChatPage";
import { conversationIdFromPath } from "@/pages/chat/conversation-route";
import { KnowledgePage } from "@/pages/knowledge/KnowledgePage";
import { MemoryPage } from "@/pages/memory/MemoryPage";
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

  if (path === "/" || conversationIdFromPath(path) !== null) {
    return (
      <>
        <title>Agent Chat · Agent Playground</title>
        <ChatPage development={appConfig.development} />
      </>
    );
  }

  if (path === "/knowledge") {
    return (
      <>
        <title>Knowledge · Agent Playground</title>
        <KnowledgePage />
      </>
    );
  }

  if (path === "/memory") {
    return (
      <>
        <title>Memory · Agent Playground</title>
        <MemoryPage />
      </>
    );
  }

  if (path === "/dev/a2ui-components" && ComponentsPage) {
    return (
      <>
        <title>A2UI Components · Agent Playground</title>
        <Suspense
          fallback={
            <div
              role="status"
              aria-label="Loading components"
              className="min-h-dvh space-y-4 bg-canvas p-8 text-sm text-muted"
            >
              <div className="flex items-center gap-2">
                <Spinner aria-hidden="true" />
                Loading components…
              </div>
              <Skeleton className="h-10 max-w-sm" />
              <Skeleton className="h-80" />
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
