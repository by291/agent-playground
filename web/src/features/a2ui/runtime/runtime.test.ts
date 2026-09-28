import assert from "node:assert/strict";
import test from "node:test";
import { NodeResolver, getValue, type A2uiMessage } from "@a2ui/web_core/v0_9";
import { workflowCatalog } from "../catalog/index";
import { createA2UIRuntime } from "./runtime";

function output(outputSeq: number, messages: A2uiMessage[]) {
  return {
    id: `output-${outputSeq}`,
    outputSeq,
    toolCallId: "workflow",
    messages,
  };
}

function creation(surfaceId = "main"): A2uiMessage[] {
  return [
    {
      version: "v0.9",
      createSurface: { surfaceId, catalogId: workflowCatalog.id },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId,
        components: [
          {
            id: "root",
            component: "WorkflowText",
            role: "title",
            text: "Initial",
          },
        ],
      },
    },
  ];
}

void test("one processor keeps surfaces alive across component and data updates, then deletes them", () => {
  const runtime = createA2UIRuntime();
  const initial = runtime.ingest([
    output(1, [...creation(), ...creation("second")]),
  ]);

  assert.equal(initial.surfaces.length, 2);
  const surface = initial.surfaces[0]!.surface;
  const updated = runtime.ingest([
    output(2, [
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "main",
          components: [
            {
              id: "root",
              component: "WorkflowText",
              role: "title",
              text: { path: "/title" },
            },
          ],
        },
      },
      {
        version: "v0.9",
        updateDataModel: {
          surfaceId: "main",
          path: "/title",
          value: "Updated",
        },
      },
    ]),
  ]);

  assert.equal(updated.kind, "ready");
  assert.equal(updated.surfaces[0]!.surface, surface);
  assert.equal(surface.dataModel.get("/title"), "Updated");
  const resolver = new NodeResolver(surface, workflowCatalog);

  assert.equal(getValue(resolver.rootNode)?.toJSON().text, "Updated");
  runtime.ingest([
    output(3, [
      {
        version: "v0.9",
        updateDataModel: {
          surfaceId: "main",
          path: "/title",
          value: "Live binding",
        },
      },
    ]),
  ]);
  assert.equal(getValue(resolver.rootNode)?.toJSON().text, "Live binding");
  resolver.dispose();
  const removed = runtime.ingest([
    output(4, [{ version: "v0.9", deleteSurface: { surfaceId: "main" } }]),
  ]);

  assert.deepEqual(
    removed.surfaces.map((item) => item.surface.id),
    ["second"],
  );
  assert.equal(removed.surfaces[0]!.toolCallId, "workflow");
  runtime.dispose();
});

void test("a failed batch hides its touched surfaces and cannot leave a partial preview", () => {
  const runtime = createA2UIRuntime();

  runtime.ingest([output(1, creation("saved"))]);
  const result = runtime.ingest([
    output(2, [
      ...creation("partial"),
      {
        version: "v0.9",
        updateDataModel: {
          surfaceId: "missing",
          path: "/status",
          value: "bad",
        },
      },
    ]),
  ]);

  assert.match(result.kind === "failed" ? result.error : "", /missing/i);
  assert.deepEqual(
    result.surfaces.map((view) => view.surface.id),
    ["saved"],
  );
  assert.equal(
    runtime.ingest([output(3, creation("later"))]).surfaces.length,
    1,
  );
  runtime.dispose();
});

for (const text of [
  { path: "/constructor" },
  {
    call: "unknown",
    args: { value: { path: "/constructor" } },
    returnType: "string",
  },
  {
    call: "unknown",
    args: {
      value: {
        call: "unknown",
        args: { items: [{ path: "/constructor" }] },
        returnType: "string",
      },
    },
    returnType: "string",
  },
] as const) {
  void test(`invalid incremental binding paths fail before reactive callbacks: ${JSON.stringify(text)}`, () => {
    const runtime = createA2UIRuntime();
    const initial = runtime.ingest([output(1, creation())]);
    const resolver = new NodeResolver(
      initial.surfaces[0]!.surface,
      workflowCatalog,
    );

    assert.equal(getValue(resolver.rootNode)?.toJSON().text, "Initial");
    const result = runtime.ingest([
      output(2, [
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "main",
            components: [
              {
                id: "root",
                component: "WorkflowText",
                role: "title",
                text,
              },
            ],
          },
        },
      ]),
    ]);

    assert.match(result.kind === "failed" ? result.error : "", /binding path/i);
    assert.equal(result.surfaces.length, 0);
    resolver.dispose();
    runtime.dispose();
  });
}

void test("a missing output waits for recovery and an older snapshot cannot replay creation or revert data", () => {
  const runtime = createA2UIRuntime();
  const first = output(1, creation());
  const second = output(2, [
    {
      version: "v0.9",
      updateDataModel: { surfaceId: "main", path: "/status", value: "done" },
    },
  ]);
  const gap = runtime.ingest([second]);

  assert.equal(gap.kind, "waiting");
  assert.equal(gap.surfaces.length, 0);
  assert.equal(gap.kind === "waiting" ? gap.missingOutputSeq : null, 1);
  const recovered = runtime.ingest([second, first]);

  assert.equal(recovered.kind, "ready");
  assert.equal(recovered.kind, "ready");
  assert.equal(recovered.surfaces[0]!.surface.dataModel.get("/status"), "done");
  const surface = recovered.surfaces[0]!.surface;

  assert.equal(runtime.ingest([first]).surfaces[0]!.surface, surface);
  assert.equal(surface.dataModel.get("/status"), "done");
  runtime.dispose();
});

void test("JSON object key order does not make a repeated output conflict", () => {
  const runtime = createA2UIRuntime();
  const first = output(1, creation());

  runtime.ingest([first]);
  const reordered = output(1, [
    {
      version: "v0.9",
      createSurface: { catalogId: workflowCatalog.id, surfaceId: "main" },
    },
    {
      version: "v0.9",
      updateComponents: {
        components: [
          {
            text: "Initial",
            role: "title",
            component: "WorkflowText",
            id: "root",
          },
        ],
        surfaceId: "main",
      },
    },
  ]);

  assert.equal(runtime.ingest([reordered]).kind, "ready");
  runtime.dispose();
});

void test("conflicting output identities keep the original surface and report an error", () => {
  const runtime = createA2UIRuntime();
  const first = output(1, creation());
  const initial = runtime.ingest([first]);
  const conflict = runtime.ingest([
    { ...first, messages: creation("changed") },
  ]);

  assert.match(
    conflict.kind === "failed" ? conflict.error : "",
    /conflicting/i,
  );
  assert.equal(conflict.surfaces[0]!.surface, initial.surfaces[0]!.surface);
  const repeatedConflict = runtime.ingest([{ ...first, id: "another-id" }]);

  assert.match(
    repeatedConflict.kind === "failed" ? repeatedConflict.error : "",
    /conflicting/i,
  );
  runtime.dispose();
});

void test("unknown catalogs and surfaces report processing failures without hiding earlier output", () => {
  const runtime = createA2UIRuntime();

  runtime.ingest([output(1, creation())]);
  const result = runtime.ingest([
    output(2, [
      {
        version: "v0.9",
        updateDataModel: {
          surfaceId: "missing",
          path: "/status",
          value: "bad",
        },
      },
    ]),
  ]);

  assert.match(
    result.kind === "failed" ? result.error : "",
    /surface.*missing/i,
  );
  assert.equal(result.surfaces.length, 1);
  runtime.dispose();
  const other = createA2UIRuntime();
  const unsupported = other.ingest([
    output(1, [
      {
        version: "v0.9",
        createSurface: { surfaceId: "unknown", catalogId: "unknown" },
      },
    ]),
  ]);

  assert.match(
    unsupported.kind === "failed" ? unsupported.error : "",
    /catalog.*unknown/i,
  );
  other.dispose();
});

void test("runtime state belongs to one conversation and disposal releases its surfaces", () => {
  const first = createA2UIRuntime();
  const second = createA2UIRuntime();

  first.ingest([output(1, creation())]);
  assert.equal(second.ingest([]).surfaces.length, 0);
  first.dispose();
  assert.equal(first.ingest([]).surfaces.length, 0);
  second.dispose();
});
