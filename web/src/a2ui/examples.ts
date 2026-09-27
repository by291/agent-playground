import { MessageProcessor } from "@a2ui/web_core/v0_9";
import type { A2UICard } from "./card";
import { parseA2UICard } from "./card";
import { workflowCatalog } from "./catalog";
import panelExample from "./examples/workflow-panel.json";
import stepsExample from "./examples/workflow-steps.json";
import textExample from "./examples/workflow-text.json";

export function parseGalleryPreview(
  component: string,
  source: string,
): { card: A2UICard | null; error: string | null } {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return { card: null, error: "Enter valid JSON to update the preview." };
  }

  const card = parseA2UICard(component, value);
  const creation = card?.messages.find((message) => "createSurface" in message);
  if (
    !card ||
    !creation ||
    !("createSurface" in creation) ||
    creation.createSurface.catalogId !== workflowCatalog.id
  ) {
    return {
      card: null,
      error: "Use an A2UI card from the workflow catalog.",
    };
  }

  try {
    const processor = new MessageProcessor([workflowCatalog]);
    processor.processMessages(card.messages);
    const surface = processor.model.getSurface(
      creation.createSurface.surfaceId,
    );
    if (!surface?.componentsModel.get("root")) {
      throw new Error("Missing root component");
    }
  } catch {
    return { card: null, error: "The A2UI components could not be rendered." };
  }

  return { card, error: null };
}

const exampleFiles = [panelExample, textExample, stepsExample];

export const catalogExamples = exampleFiles.map((example) => {
  const source = JSON.stringify(example, null, 2);
  const result = parseGalleryPreview(example.component, source);
  if (!result.card) {
    throw new Error(`Invalid gallery example: ${example.component}`);
  }
  return {
    component: example.component,
    description: example.description,
    source,
    messages: result.card.messages,
  };
});
