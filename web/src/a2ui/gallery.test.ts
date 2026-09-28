import assert from "node:assert/strict";
import test from "node:test";
import { workflowCatalog } from "./catalog";
import { parseGalleryPreview } from "./examples";

const validJson = JSON.stringify({
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

void test("edited JSON produces the surface used for the preview", () => {
  const result = parseGalleryPreview("WorkflowText", validJson);

  assert.equal(result.error, null);
  assert.equal(
    result.surfaces?.[0]?.surface.componentsModel.get("root")?.properties.text,
    "Edited title",
  );
});

void test("invalid JSON leaves no replacement preview", () => {
  const result = parseGalleryPreview("WorkflowText", "{");

  assert.ok(result.surfaces === null);
  assert.match(result.error ?? "", /valid JSON/i);
});

void test("a different catalog cannot replace the selected preview", () => {
  const result = parseGalleryPreview(
    "WorkflowText",
    validJson.replace(workflowCatalog.id, "urn:unknown:catalog"),
  );

  assert.equal(result.surfaces, null);
  assert.match(result.error ?? "", /catalog/i);
});

void test("unknown component types cannot replace a valid preview", () => {
  const result = parseGalleryPreview(
    "WorkflowText",
    validJson.replace('"component":"WorkflowText"', '"component":"Unknown"'),
  );
  assert.equal(result.surfaces, null);
  assert.match(result.error ?? "", /Unknown.*catalog/i);
});
