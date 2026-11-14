import type { ReactComponentImplementation } from "@a2ui/react/v0_9";
import { MessageProcessor, NodeResolver } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import {
  parseA2UIMessages,
  workflowCatalog,
  type A2UISurfaceView,
} from "@/features/a2ui";

const previewSchema = z
  .object({
    component: z.string().optional(),
    description: z.string().optional(),
    messages: z.unknown(),
  })
  .strict();

/** Parses the editor's example document into SDK messages. */
export function parsePreviewSource(source: string) {
  let value: unknown;

  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("Enter valid JSON to update the preview.");
  }

  return parseA2UIMessages(previewSchema.parse(value).messages);
}

/** Builds a complete preview whose model is released by the returned disposer. */
export function createGalleryPreview(
  component: string,
  source: string,
): {
  surfaces: A2UISurfaceView[] | null;
  error: string | null;
  dispose: () => void;
} {
  const processor = new MessageProcessor<ReactComponentImplementation>([
    workflowCatalog,
  ]);

  try {
    processor.processMessages(parsePreviewSource(source));

    const surfaces = [...processor.model.surfacesMap.values()];

    if (surfaces.length === 0) {
      throw new Error("The preview needs a surface with a root component.");
    }

    for (const surface of surfaces) {
      // The live renderer can wait for missing children, but a preview is a complete batch.
      surface.componentsModel.validateTopology({
        rootId: surface.rootId,
        allowOrphanComponents: true,
      });

      checkResolvedSurface(surface);
    }

    return {
      surfaces: surfaces.map((surface) => ({
        id: `${component}:${surface.id}`,
        surface,
      })),
      error: null,
      dispose: () => processor.model.dispose(),
    };
  } catch (error) {
    processor.model.dispose();

    return {
      surfaces: null,
      dispose: () => {
        /* Failed creation already released its model. */
      },
      error:
        error instanceof Error
          ? error.message
          : "Could not process A2UI messages.",
    };
  }
}

function checkResolvedSurface(surface: A2UISurfaceView["surface"]) {
  // Binding and catalog errors can surface only after the SDK resolves the tree.
  let issue: string | undefined;
  const subscription = surface.onError.subscribe((error: unknown) => {
    issue =
      typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : "Could not resolve A2UI components.";
  });

  try {
    const resolver = new NodeResolver(surface, workflowCatalog);

    resolver.dispose();
  } finally {
    subscription.unsubscribe();
  }

  if (issue) {
    throw new Error(issue);
  }
}
