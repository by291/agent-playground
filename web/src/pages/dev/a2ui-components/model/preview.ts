import type { ReactComponentImplementation } from "@a2ui/react/v0_9";
import { MessageProcessor, NodeResolver } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import { workflowCatalog } from "@/features/a2ui";
import { parseA2UIMessages } from "@/features/a2ui";
import type { A2UISurfaceView } from "@/features/a2ui";
const previewSchema = z
  .object({
    component: z.string().optional(),
    description: z.string().optional(),
    messages: z.unknown(),
  })
  .strict();

export function parsePreviewSource(source: string) {
  let value: unknown;

  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("Enter valid JSON to update the preview.");
  }

  return parseA2UIMessages(previewSchema.parse(value).messages);
}

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

    if (
      !surfaces.length ||
      surfaces.some((surface) => !surface.componentsModel.get("root"))
    ) {
      throw new Error("The preview needs a surface with a root component.");
    }

    // Some catalog/tree errors are reported during node resolution, after
    // message validation. Check them before replacing the last valid preview.
    for (const surface of surfaces) {
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
