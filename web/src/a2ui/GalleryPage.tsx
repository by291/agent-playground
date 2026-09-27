import {
  ArrowLeftIcon,
  ArrowCounterClockwiseIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { A2UICard } from "./A2UICard";
import type { A2UICard as CardData } from "./card";
import { workflowCatalog, workflowComponentNames } from "./catalog";
import { catalogExamples, parseGalleryPreview } from "./examples";
import { JsonEditor } from "./JsonEditor";

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
          <span className="rounded-full border border-accent-line bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
            {workflowComponentNames.length} components
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8 sm:py-10">
        <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-accent uppercase">
              {workflowCatalog.id}
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
            <select
              id="gallery-component"
              value={component}
              onChange={(event) => setComponent(event.target.value)}
              className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {catalogExamples.map((item) => (
                <option key={item.component} value={item.component}>
                  {item.component}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="mb-5 text-sm text-muted">{example.description}</p>

        <div className="grid gap-5 sm:grid-cols-2">
          <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
            <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-5">
              <h2 className="text-sm font-semibold">JSON example</h2>
              <button
                type="button"
                onClick={resetSource}
                disabled={drafts[component] === undefined}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-medium text-muted hover:text-ink disabled:cursor-default disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <ArrowCounterClockwiseIcon size={15} aria-hidden="true" />
                Reset
              </button>
            </div>
            <div className="h-[58vh] min-h-96 lg:h-[68vh] lg:min-h-140">
              <JsonEditor
                component={component}
                value={source}
                onChange={updateSource}
              />
            </div>
            <div
              role={result.error ? "alert" : "status"}
              className={`min-h-12 border-t px-5 py-3 text-xs ${result.error ? "border-red-200 bg-red-50 text-red-700" : "border-line text-muted"}`}
            >
              {result.error ?? "Valid A2UI JSON · preview updated"}
            </div>
          </section>

          <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
            <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-5">
              <h2 className="text-sm font-semibold">Rendered preview</h2>
              <span className="text-xs text-muted">
                {result.error ? "Last valid JSON" : "Live"}
              </span>
            </div>
            <div className="flex min-h-96 flex-1 items-start justify-center bg-canvas p-5 sm:p-8 lg:min-h-140">
              <div className="w-full max-w-xl">
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
