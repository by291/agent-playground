import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { RunAgentInput } from "@ag-ui/client";

const boundary = vi.hoisted(() => ({
  input: undefined as RunAgentInput | undefined,
}));

vi.mock("./hitl", () => ({
  ReviewLangGraphAgent: class {
    run(input: RunAgentInput) {
      boundary.input = input;

      return [];
    }
  },
}));
const { runAgent } = await import("./run");

test("upstream configuration uses the pinned model and discards client provider settings", () => {
  const input: RunAgentInput = {
    threadId: "thread",
    runId: "run",
    messages: [],
    state: {},
    tools: [],
    context: [],
    forwardedProps: {
      modelId: "deepseek",
      config: { configurable: { model_id: "attacker", api_key: "attacker" } },
      graphId: "attacker",
    },
  };

  runAgent(
    input,
    () => undefined,
    () => Promise.resolve(),
    "qwen",
  );
  const props = boundary.input?.forwardedProps as {
    config: object;
    graphId?: string;
  };

  assert.deepEqual(props.config, {
    configurable: { model_id: "qwen" },
    metadata: { agui_run_id: "run" },
  });
  assert.equal(props.graphId, undefined);
});
