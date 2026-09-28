import { test } from "vitest";
import assert from "node:assert/strict";
import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { catalogExamples } from "./examples";
import { workflowCatalog } from "@/features/a2ui";
import { createGalleryPreview } from "./preview";

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

test("edited JSON produces the surface used for the preview", () => {
  const result = createGalleryPreview("WorkflowText", validJson);

  assert.equal(result.error, null);
  assert.equal(
    result.surfaces?.[0]?.surface.componentsModel.get("root")?.properties.text,
    "Edited title",
  );
  result.dispose();
});

test("invalid JSON leaves no replacement preview", () => {
  const result = createGalleryPreview("WorkflowText", "{");

  assert.ok(result.surfaces === null);
  assert.match(result.error ?? "", /valid JSON/i);
});

test("a different catalog cannot replace the selected preview", () => {
  const result = createGalleryPreview(
    "WorkflowText",
    validJson.replace(workflowCatalog.id, "urn:unknown:catalog"),
  );

  assert.equal(result.surfaces, null);
  assert.match(result.error ?? "", /catalog/i);
});

test("unknown component types cannot replace a valid preview", () => {
  const result = createGalleryPreview(
    "WorkflowText",
    validJson.replace('"component":"WorkflowText"', '"component":"Unknown"'),
  );

  assert.equal(result.surfaces, null);
  assert.match(result.error ?? "", /Unknown.*catalog/i);
});

test("replacement, invalid edits, reset and unmount own the preview resources", async () => {
  const { createGalleryPreviews } = await import("./galleryPreviews");
  const examples = [
    { component: "WorkflowText", source: validJson },
    { component: "WorkflowPanel", source: validJson },
  ];
  const disposed: string[] = [];
  const owner = createGalleryPreviews(examples, (component, source) => {
    const preview = createGalleryPreview(component, source);

    if (preview.surfaces) {
      const surface = preview.surfaces[0]!.surface;
      const dispose = surface.dispose.bind(surface);

      surface.dispose = () => {
        disposed.push(component);
        dispose();
      };
    }

    return preview;
  });

  assert.deepEqual(owner.getSnapshot(), {});
  owner.initialize();
  const first = owner.getSnapshot().WorkflowText!;

  owner.update("WorkflowText", "{");
  const invalid = owner.getSnapshot().WorkflowText!;

  assert.equal(invalid.surfaces, first.surfaces);
  assert.equal(invalid.source, validJson);
  assert.equal(invalid.draft, "{");
  assert.match(invalid.error ?? "", /valid JSON/i);
  assert.deepEqual(disposed, []);

  const edited = validJson.replace("Edited title", "Replacement title");

  owner.update("WorkflowText", edited);
  const replacement = owner.getSnapshot().WorkflowText!;

  assert.notEqual(replacement.surfaces[0]!.surface, first.surfaces[0]!.surface);
  assert.equal(replacement.source, edited);
  assert.deepEqual(disposed, ["WorkflowText"]);

  owner.reset("WorkflowText");
  const reset = owner.getSnapshot().WorkflowText!;

  assert.equal(reset.draft, validJson);
  assert.equal(reset.source, validJson);
  assert.equal(reset.error, null);
  assert.deepEqual(disposed, ["WorkflowText", "WorkflowText"]);

  owner.dispose();
  assert.deepEqual(owner.getSnapshot(), {});
  assert.deepEqual(
    disposed.sort(),
    ["WorkflowPanel", "WorkflowText", "WorkflowText", "WorkflowText"].sort(),
  );
  owner.dispose();
  assert.equal(disposed.length, 4);
  // React StrictMode can mount the same owner again after effect cleanup.
  owner.initialize();
  assert.equal(owner.getSnapshot().WorkflowText!.source, validJson);
  owner.dispose();
  assert.equal(disposed.length, 6);
});

test("every registered component has a processable gallery preview", () => {
  assert.deepEqual(
    catalogExamples.map((example) => example.component).sort(),
    [...workflowCatalog.components.keys()].sort(),
  );

  for (const example of catalogExamples) {
    const processor = new MessageProcessor([workflowCatalog]);

    processor.processMessages(example.messages);
    assert.ok(
      [...processor.model.surfacesMap.values()].every((surface) =>
        surface.componentsModel.get("root"),
      ),
      example.component,
    );
    processor.model.dispose();
  }
});
