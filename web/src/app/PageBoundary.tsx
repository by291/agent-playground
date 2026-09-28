import { Component, type ReactNode } from "react";
import { reportClientError } from "@/observability/tracing";

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
          <h1 className="text-xl font-semibold">Could not load this page</h1>
          <p className="text-sm text-muted">Reload the page to try again.</p>
          <a
            href={window.location.pathname}
            className="rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Reload page
          </a>
        </main>
      );
    }

    return this.props.children;
  }
}
