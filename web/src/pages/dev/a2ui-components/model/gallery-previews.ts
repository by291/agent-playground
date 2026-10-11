import { createGalleryPreview } from "./preview";

interface Example {
  component: string;
  source: string;
}

type Resource = ReturnType<typeof createGalleryPreview>;
export interface GalleryPreview {
  draft: string;
  source: string;
  surfaces: NonNullable<Resource["surfaces"]>;
  error: string | null;
}

// This owner is created without models; initialization happens after mount.
export function createGalleryPreviews(
  examples: Example[],
  createPreview = createGalleryPreview,
) {
  const resources = new Map<string, Resource>();
  const listeners = new Set<() => void>();
  let snapshot: Record<string, GalleryPreview> = {};

  function update(component: string, draft: string) {
    const replacement = createPreview(component, draft);
    const previous = snapshot[component];
    let preview: GalleryPreview;

    if (replacement.surfaces) {
      resources.get(component)?.dispose();
      resources.set(component, replacement);
      preview = {
        draft,
        source: draft,
        surfaces: replacement.surfaces,
        error: null,
      };
    } else {
      replacement.dispose();
      preview = {
        draft,
        source: previous?.source ?? "",
        surfaces: previous?.surfaces ?? [],
        error: replacement.error,
      };
    }

    snapshot = { ...snapshot, [component]: preview };

    for (const listener of listeners) {
      listener();
    }
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(this: void, listener: () => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    initialize() {
      for (const example of examples) {
        update(example.component, example.source);
      }
    },

    update,

    reset(this: void, component: string) {
      const example = examples.find((item) => item.component === component);

      if (example) {
        update(component, example.source);
      }
    },

    dispose() {
      for (const resource of resources.values()) {
        resource.dispose();
      }

      resources.clear();
      snapshot = {};
    },
  };
}
