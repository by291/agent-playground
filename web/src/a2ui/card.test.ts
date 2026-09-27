import assert from "node:assert/strict";
import test from "node:test";
import { basicCatalog } from "@a2ui/react/v0_9";
import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { parseA2UICard } from "./card";
import { workflowCatalog } from "./catalog";
import { catalogExamples } from "./examples";

void test("accepts a surface from the playground catalog", () => {
  const card = parseA2UICard(
    "output-1",
    JSON.stringify({
      kind: "a2ui",
      messages: [
        {
          version: "v0.9",
          createSurface: {
            surfaceId: "preview",
            catalogId: "urn:agent-playground:workflow:v1",
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
                text: "Preview",
                role: "title",
              },
            ],
          },
        },
      ],
    }),
  );

  assert.ok(card);
  assert.equal(card.messages.length, 2);
});

void test("accepts a structured A2UI event without serializing it", () => {
  const card = parseA2UICard("output-2", {
    kind: "a2ui",
    messages: [
      {
        version: "v0.9",
        createSurface: {
          surfaceId: "preview-object",
          catalogId: workflowCatalog.id,
        },
      },
    ],
  });

  assert.equal(card?.id, "output-2");
});

void test("keeps persisted Basic Catalog cards readable", () => {
  const card = parseA2UICard("old-output", {
    kind: "a2ui",
    messages: [
      {
        version: "v0.9",
        createSurface: {
          surfaceId: "old-card",
          catalogId: basicCatalog.id,
        },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "old-card",
          components: [
            { id: "root", component: "Card", child: "text" },
            { id: "text", component: "Text", text: "Saved card" },
          ],
        },
      },
    ],
  });

  assert.ok(card);
  const processor = new MessageProcessor([workflowCatalog, basicCatalog]);
  processor.processMessages(card.messages);
  assert.ok(
    processor.model.getSurface("old-card")?.componentsModel.get("root"),
  );
});

void test("every registered component has a processable gallery preview", () => {
  assert.deepEqual(
    catalogExamples.map((example) => example.component).sort(),
    [...workflowCatalog.components.keys()].sort(),
  );

  for (const example of catalogExamples) {
    const processor = new MessageProcessor([workflowCatalog]);
    processor.processMessages(example.messages);
    const creation = example.messages.find(
      (message) => "createSurface" in message,
    );
    assert.ok(creation && "createSurface" in creation);
    const surface = processor.model.getSurface(
      creation.createSurface.surfaceId,
    );
    assert.ok(surface?.componentsModel.get("root"), example.component);
  }
});
