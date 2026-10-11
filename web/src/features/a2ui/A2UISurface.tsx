import { A2uiSurface } from "@a2ui/react/v0_9";
import { Component, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { A2UISurfaceView } from "./runtime/a2ui-runtime";
import { reportClientError } from "@/shared/observability/tracing";

export function A2UISurface({
  view,
  inChat = true,
}: {
  view: A2UISurfaceView;
  inChat?: boolean;
}) {
  return (
    <div className={inChat ? "ml-11 sm:ml-12" : undefined}>
      <SurfaceErrorBoundary
        key={view.id}
        surfaceId={view.id}
        surface={view.surface}
      >
        <A2uiSurface surface={view.surface} />
      </SurfaceErrorBoundary>
    </div>
  );
}

class SurfaceErrorBoundary extends Component<
  {
    children: ReactNode;
    surfaceId: string;
    surface: A2UISurfaceView["surface"];
  },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };
  private subscription?: { unsubscribe: () => void };

  componentDidMount() {
    // Subscribe before the official renderer resolves its node tree.
    this.subscription = this.props.surface.onError.subscribe(
      (error: unknown) => {
        const detail =
          typeof error === "object" && error !== null && "message" in error
            ? String(error.message)
            : "Rendering failed";

        this.setState({ error: detail });
        reportClientError(new Error(detail), {
          "app.surface_id": this.props.surfaceId,
        });
      },
    );
  }

  componentWillUnmount() {
    this.subscription?.unsubscribe();
  }

  componentDidCatch(error: unknown) {
    reportClientError(error, { "app.surface_id": this.props.surfaceId });
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      error: error instanceof Error ? error.message : "Rendering failed",
    };
  }

  render() {
    if (this.state.error) {
      return (
        <Alert variant="destructive">
          <AlertDescription>
            Could not render A2UI surface: {this.state.error}
          </AlertDescription>
        </Alert>
      );
    }

    return this.props.children;
  }
}
