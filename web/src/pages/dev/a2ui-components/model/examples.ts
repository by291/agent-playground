import panelExample from "../examples/workflow-panel.json";
import stepsExample from "../examples/workflow-steps.json";
import textExample from "../examples/workflow-text.json";
import sqlExample from "../examples/workflow-sql.json";
import { createGalleryPreview } from "./preview";
import { parseA2UIMessages } from "@/features/a2ui";

const exampleFiles = [panelExample, textExample, stepsExample, sqlExample];

export const catalogExamples = exampleFiles.map((example) => {
  const source = JSON.stringify(example, null, 2);
  const result = createGalleryPreview(example.component, source);

  try {
    if (!result.surfaces) {
      throw new Error(
        `Invalid gallery example: ${example.component}: ${result.error}`,
      );
    }
  } finally {
    result.dispose();
  }

  return {
    component: example.component,
    description: example.description,
    source,
    messages: parseA2UIMessages(example.messages),
  };
});
