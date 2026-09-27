import {
  ArrowLeftIcon,
  ArrowCounterClockwiseIcon,
  BracketsCurlyIcon,
  EyeIcon,
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
import { A2UICard } from "./A2UICard";
import type { A2UICard as CardData } from "./card";
import { workflowCatalog, workflowComponentNames } from "./catalog";
import { catalogExamples, parseGalleryPreview } from "./examples";

const JsonEditor = lazy(() =>
  import("./JsonEditor").then(({ JsonEditor }) => ({ default: JsonEditor })),
);

interface Preview {
  card: CardData;
  source: string;
}

export function GalleryPage() {
  const [component, setComponent] = useState(
    catalogExamples[0]?.component ?? "",
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [lastValid, setLastValid] = useState<Record<string, Preview>>({});
  const example = catalogExamples.find((item) => item.component === component);
  if (!example) return null;

  const source = drafts[component] ?? example.source;
  const result = parseGalleryPreview(component, source);
  const preview: Preview = result.card
    ? { card: result.card, source }
    : (lastValid[component] ?? {
        card: { id: component, messages: example.messages },
        source: example.source,
      });

  function updateSource(next: string) {
    setDrafts((current) => ({ ...current, [component]: next }));
    const updated = parseGalleryPreview(component, next);
    if (updated.card) {
      const card = updated.card;
      setLastValid((current) => ({
        ...current,
        [component]: { card, source: next },
      }));
    }
  }

  function resetSource() {
    setDrafts((current) => {
      const next = { ...current };
      delete next[component];
      return next;
    });
    setLastValid((current) => {
      const next = { ...current };
      delete next[component];
      return next;
    });
  }

  return (
    <div className="min-h-dvh bg-canvas font-sans text-ink">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
          <a
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <ArrowLeftIcon size={18} aria-hidden="true" />
            Agent chat
          </a>
          <Badge
            variant="secondary"
            className="h-auto gap-1.5 border border-accent-line bg-accent-soft px-3 py-1 text-accent"
          >
            <SquaresFourIcon size={14} aria-hidden="true" />
            {workflowComponentNames.length} components
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8 sm:py-10">
        <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p
              title={workflowCatalog.id}
              className="mb-2 text-xs font-semibold tracking-[0.14em] text-accent uppercase"
            >
              Workflow catalog
            </p>
            <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
              A2UI component gallery
            </h1>
            <p className="mt-2 max-w-2xl text-sm/6 text-muted">
              Edit a component’s JSON example to see its rendered result.
            </p>
          </div>
          <div className="w-full md:w-72">
            <label
              htmlFor="gallery-component"
              className="mb-2 block text-xs font-semibold text-muted"
            >
              Component
            </label>
            <NativeSelect
              id="gallery-component"
              value={component}
              onChange={(event) => setComponent(event.target.value)}
              className="w-full [&_select]:min-h-11 [&_select]:rounded-xl [&_select]:bg-white [&_select]:font-medium"
            >
              {catalogExamples.map((item) => (
                <NativeSelectOption key={item.component} value={item.component}>
                  {item.component}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>

        <p className="mb-5 text-sm text-muted">{example.description}</p>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
            <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-5">
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
                onClick={resetSource}
                disabled={drafts[component] === undefined}
                className="min-h-11 px-2 text-xs text-muted hover:bg-accent-soft hover:text-ink"
              >
                <ArrowCounterClockwiseIcon size={15} aria-hidden="true" />
                Reset
              </Button>
            </div>
            <div className="h-[52vh] min-h-88 lg:h-[68vh] lg:min-h-140">
              <Suspense
                fallback={
                  <p className="p-4 text-sm text-muted">Loading editor…</p>
                }
              >
                <JsonEditor
                  component={component}
                  value={source}
                  onChange={updateSource}
                />
              </Suspense>
            </div>
            {result.error ? (
              <Alert
                variant="destructive"
                className="min-h-12 rounded-none border-0 border-t border-red-200 bg-red-50 px-5 py-3"
              >
                <AlertDescription className="text-xs text-red-700">
                  {result.error}
                </AlertDescription>
              </Alert>
            ) : (
              <div
                role="status"
                className="min-h-12 border-t border-line px-5 py-3 text-xs text-muted"
              >
                Valid A2UI JSON · preview updated
              </div>
            )}
          </section>

          <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
            <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <EyeIcon size={18} className="text-accent" aria-hidden="true" />
                Rendered preview
              </h2>
              <Badge
                variant="secondary"
                className={`h-auto gap-1.5 px-2.5 py-1 ${result.error ? "bg-amber-50 text-amber-800" : "bg-accent-soft text-accent"}`}
              >
                <span
                  className={`size-1.5 rounded-full ${result.error ? "bg-amber-600" : "bg-accent"}`}
                />
                {result.error ? "Last valid JSON" : "Live"}
              </Badge>
            </div>
            <div className="flex min-h-80 flex-1 items-start justify-center bg-canvas p-5 sm:p-8 lg:min-h-140">
              {/* A JSON edit updates the card without replaying the entrance. */}
              <div
                key={component}
                className="gallery-preview-enter w-full max-w-xl"
              >
                <A2UICard
                  key={preview.source}
                  card={preview.card}
                  inChat={false}
                />
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
