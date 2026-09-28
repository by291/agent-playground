import { MessageProcessor, NodeResolver } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import { workflowCatalog } from "./catalog";
import { parseA2UIMessages } from "./messages";
import type { A2UISurfaceView } from "./runtime";
import panelExample from "./examples/workflow-panel.json";
import stepsExample from "./examples/workflow-steps.json";
import textExample from "./examples/workflow-text.json";

const previewSchema = z
  .object({
    component: z.string().optional(),
    description: z.string().optional(),
    messages: z.unknown(),
  })
  .strict();

export function parseGalleryPreview(
  component: string,
  source: string,
): {
  surfaces: A2UISurfaceView[] | null;
  error: string | null;
} {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return { surfaces: null, error: "Enter valid JSON to update the preview." };
  }

  const processor = new MessageProcessor([workflowCatalog]);
  try {
    const preview = previewSchema.parse(value);
    processor.processMessages(parseA2UIMessages(preview.messages));
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
      const resolver = new NodeResolver(surface, workflowCatalog);
      resolver.dispose();
      subscription.unsubscribe();
      if (issue) throw new Error(issue);
    }
    return {
      surfaces: surfaces.map((surface) => ({
        id: `${component}:${surface.id}`,
        surface,
      })),
      error: null,
    };
  } catch (error) {
    processor.model.dispose();
    return {
      surfaces: null,
      error:
        error instanceof Error
          ? error.message
          : "Could not process A2UI messages.",
    };
  }
}

const exampleFiles = [panelExample, textExample, stepsExample];

export const catalogExamples = exampleFiles.map((example) => {
  const source = JSON.stringify(example, null, 2);
  const result = parseGalleryPreview(example.component, source);
  if (!result.surfaces)
    throw new Error(`Invalid gallery example: ${example.component}`);
  for (const view of result.surfaces) view.surface.dispose();
  return {
    component: example.component,
    description: example.description,
    source,
    messages: parseA2UIMessages(example.messages),
  };
});
