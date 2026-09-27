import assert from "node:assert/strict";
import test from "node:test";
import { basicCatalog } from "@a2ui/react/v0_9";
import { workflowCatalog } from "./catalog";
import { parseGalleryPreview } from "./examples";

const validJson = JSON.stringify({
  kind: "a2ui",
  messages: [
    {
      version: "v0.9",
      createSurface: {
        surfaceId: "preview",
        catalogId: workflowCatalog.id,
      },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "preview",
        components: [
          {
            id: "root",
            component: "WorkflowText",
            role: "title",
            text: "Edited title",
          },
        ],
      },
    },
  ],
});

void test("edited JSON produces the card used for the preview", () => {
  const result = parseGalleryPreview("WorkflowText", validJson);

  assert.equal(result.error, null);
  const update = result.card?.messages.find(
    (message) => "updateComponents" in message,
  );
  assert.ok(update && "updateComponents" in update);
  const component: unknown = update.updateComponents.components[0];
  assert.ok(component && typeof component === "object" && "text" in component);
  assert.equal(component.text, "Edited title");
});

void test("invalid JSON leaves no replacement preview", () => {
  const result = parseGalleryPreview("WorkflowText", "{");

  assert.equal(result.card, null);
  assert.match(result.error ?? "", /valid JSON/i);
});

void test("a different catalog cannot replace the selected preview", () => {
  const result = parseGalleryPreview(
    "WorkflowText",
    validJson.replace(workflowCatalog.id, basicCatalog.id),
  );

  assert.equal(result.card, null);
  assert.match(result.error ?? "", /workflow catalog/i);
});
