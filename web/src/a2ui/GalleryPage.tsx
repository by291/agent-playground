import {
  ArrowCounterClockwiseIcon,
  BracketsCurlyIcon,
  EyeIcon,
  SparkleIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import { lazy, Suspense, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { A2UISurface } from "./A2UISurface";
import { workflowCatalog, workflowComponentNames } from "./catalog";
import { catalogExamples } from "./examples";
import { useGalleryPreviews } from "./useGalleryPreviews";

const JsonEditor = lazy(() =>
  import("./JsonEditor").then(({ JsonEditor }) => ({ default: JsonEditor })),
);

export function GalleryPage() {
  const [component, setComponent] = useState(
    catalogExamples[0]?.component ?? "",
  );
  const { previews, updateSource, resetSource } = useGalleryPreviews();
  const example = catalogExamples.find((item) => item.component === component);
  const preview = previews[component];

  if (!example || !preview) {
    return null;
  }

  const source = preview.draft;

  return (
    <div className="flex min-h-dvh flex-col bg-surface font-sans text-ink lg:h-dvh">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-4 sm:px-6 lg:px-9">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent text-white">
            <SparkleIcon size={19} weight="fill" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[15px] font-semibold tracking-[-0.02em] sm:text-base">
                Agent Playground
              </h1>
              <Badge
                variant="secondary"
                className="hidden border border-accent-line bg-accent-soft text-[10px] font-semibold tracking-wide text-accent sm:inline-flex"
              >
                DEV
              </Badge>
            </div>
            <p className="text-xs text-soft">A2UI components</p>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-5 p-4 sm:p-6 lg:px-9">
        <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p
              title={workflowCatalog.id}
              className="text-sm font-semibold text-ink"
            >
              Component workspace
            </p>
            <p className="mt-1 text-xs/5 text-muted">
              Edit a component’s JSON example to see its rendered result.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Badge
              variant="secondary"
              className="hidden h-auto gap-1.5 bg-accent-soft px-2.5 py-1 text-xs text-accent sm:inline-flex"
            >
              <SquaresFourIcon size={14} aria-hidden="true" />
              {workflowComponentNames.length} components
            </Badge>
            <label
              htmlFor="gallery-component"
              className="text-xs font-medium text-muted"
            >
              Component
            </label>
            <NativeSelect
              id="gallery-component"
              value={component}
              onChange={(event) => setComponent(event.target.value)}
              className="min-w-0 flex-1 sm:w-56 [&_select]:min-h-11 [&_select]:rounded-xl [&_select]:bg-white [&_select]:font-medium"
            >
              {catalogExamples.map((item) => (
                <NativeSelectOption key={item.component} value={item.component}>
                  {item.component}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <BracketsCurlyIcon
                  size={18}
                  className="text-accent"
                  aria-hidden="true"
                />
                JSON example
              </h2>
              <Button
                type="button"
                variant="ghost"
                onClick={() => resetSource(component)}
                disabled={source === example.source}
                className="min-h-11 px-2 text-xs text-muted hover:bg-accent-soft hover:text-ink"
              >
                <ArrowCounterClockwiseIcon size={15} aria-hidden="true" />
                Reset
              </Button>
            </div>
            <div className="h-[52vh] min-h-88 lg:h-auto lg:min-h-0 lg:flex-1">
              <Suspense
                fallback={
                  <p className="p-4 text-sm text-muted">Loading editor…</p>
                }
              >
                <JsonEditor
                  component={component}
                  value={source}
                  onChange={(next) => updateSource(component, next)}
                />
              </Suspense>
            </div>
            {preview.error ? (
              <Alert
                variant="destructive"
                className="min-h-11 shrink-0 rounded-none border-0 border-t border-red-200 bg-red-50 px-4 py-3"
              >
                <AlertDescription className="text-xs text-red-700">
                  {preview.error}
                </AlertDescription>
              </Alert>
            ) : (
              <div
                role="status"
                className="min-h-11 shrink-0 border-t border-line px-4 py-3 text-xs text-muted"
              >
                Valid A2UI JSON · preview updated
              </div>
            )}
          </section>

          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <EyeIcon size={18} className="text-accent" aria-hidden="true" />
                Rendered preview
              </h2>
              <Badge
                variant="secondary"
                className={`h-auto gap-1.5 px-2.5 py-1 ${preview.error ? "bg-amber-50 text-amber-800" : "bg-accent-soft text-accent"}`}
              >
                <span
                  className={`size-1.5 rounded-full ${preview.error ? "bg-amber-600" : "bg-accent"}`}
                />
                {preview.error ? "Last valid JSON" : "Live"}
              </Badge>
            </div>
            <div className="flex min-h-80 flex-1 flex-col gap-4 overflow-auto bg-sidebar p-4 sm:p-6 lg:min-h-0">
              <p className="text-xs/5 text-muted">{example.description}</p>
              {/* A JSON edit updates the surface without replaying the entrance. */}
              <div key={component} className="gallery-preview-enter w-full">
                {preview.surfaces.map((view) => (
                  <A2UISurface
                    key={`${preview.source}:${view.id}`}
                    view={view}
                    inChat={false}
                  />
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
