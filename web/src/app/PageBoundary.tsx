import { Component, type ReactNode } from "react";
import { reportClientError } from "@/shared/observability/tracing";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export class PageBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportClientError(error, { "app.error_boundary": "page" });
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-6 text-center text-ink">
          <Empty className="flex-none">
            <EmptyHeader>
              <EmptyTitle>
                <h1 className="text-xl font-semibold">
                  Could not load this page
                </h1>
              </EmptyTitle>
              <EmptyDescription>Reload the page to try again.</EmptyDescription>
            </EmptyHeader>
            <Button asChild className="h-11 px-4">
              <a href={window.location.pathname}>Reload page</a>
            </Button>
          </Empty>
        </main>
      );
    }

    return this.props.children;
  }
}
