import { onTestFinished, test } from "vitest";
import { EventSchemas, EventType, type ResumeEntry } from "@ag-ui/client";
import { LangGraphEventTypes, type ProcessedEvents } from "@ag-ui/langgraph";
import assert from "node:assert/strict";
import { Observable } from "rxjs";
import { ReviewLangGraphAgent } from "./hitl";
import { prepareAegraRequest } from "./client";

function streamingAgent() {
  const agent = new ReviewLangGraphAgent({
    graphId: "agent",
    deploymentUrl: "http://127.0.0.1:2026",
  });
  const events: ProcessedEvents[] = [];

  agent.activeRun = {
    id: "run",
    threadId: "thread",
    hasFunctionStreaming: false,
    modelMadeToolCall: false,
  };
  const subscription = new Observable<ProcessedEvents>((subscriber) => {
    agent.subscriber = subscriber;
  }).subscribe((event) => events.push(event));

  onTestFinished(() => subscription.unsubscribe());

  return { agent, events };
}

test("nested memory writes cannot interrupt the public tool stream", () => {
  const { agent, events } = streamingAgent();

  agent.handleSingleEvent({
    event: LangGraphEventTypes.OnChatModelStream,
    metadata: { langgraph_node: "agent" },
    data: {
      chunk: {
        id: "caller",
        content: "",
        response_metadata: {},
        tool_call_chunks: [
          { id: "remember", name: "remember_memory", args: "", index: 0 },
        ],
      },
    },
  });
  agent.handleSingleEvent({
    event: LangGraphEventTypes.OnChatModelStream,
    metadata: { langgraph_node: "agent" },
    data: {
      chunk: {
        id: "caller",
        content: "",
        response_metadata: {},
        tool_call_chunks: [
          { args: '{"text":"Prefer short answers"}', index: 0 },
        ],
      },
    },
  });
  agent.handleSingleEvent({
    event: LangGraphEventTypes.OnChatModelEnd,
    metadata: { langgraph_node: "agent" },
    data: {},
  });
  // LangMem is invoked inside remember_memory without a model tool-call ID.
  agent.handleSingleEvent({
    event: LangGraphEventTypes.OnToolEnd,
    name: "manage_memory",
    metadata: { langgraph_node: "tools" },
    data: { output: "updated memory record", input: { action: "update" } },
  });
  agent.handleSingleEvent({
    event: LangGraphEventTypes.OnToolEnd,
    name: "remember_memory",
    metadata: { langgraph_node: "tools" },
    data: {
      input: { text: "Prefer short answers" },
      output: {
        update: {
          messages: [
            {
              type: "tool",
              tool_call_id: "remember",
              content: '{"memory":{"text":"Prefer short answers"}}',
              status: "success",
              name: null,
              id: null,
            },
          ],
        },
      },
    },
  });
  agent.handleSingleEvent({
    event: LangGraphEventTypes.OnChatModelStream,
    metadata: { langgraph_node: "agent" },
    data: {
      chunk: {
        id: "reply",
        content: "Preference saved.",
        response_metadata: {},
      },
    },
  });

  assert.ok(events.every((event) => EventSchemas.safeParse(event).success));
  assert.deepEqual(
    events
      .filter((event) => event.type === EventType.TOOL_CALL_RESULT)
      .map((event) => ({
        toolCallId: event.toolCallId,
        content: event.content,
      })),
    [
      {
        toolCallId: "remember",
        content: '{"memory":{"text":"Prefer short answers"}}',
      },
    ],
  );
  assert.ok(
    events.some((event) => event.type === EventType.TEXT_MESSAGE_CONTENT),
  );
});

test.each([undefined, null, "internal result", {}, { update: { counter: 1 } }])(
  "tool executions without a ToolMessage do not emit public lifecycle events: %j",
  (output) => {
    const { agent, events } = streamingAgent();

    agent.handleSingleEvent({
      event: LangGraphEventTypes.OnToolEnd,
      metadata: { langgraph_node: "tools" },
      data: { output, input: {} },
    });

    assert.deepEqual(events, []);
  },
);

test("ordinary ToolMessage results retain the official adapter lifecycle", () => {
  const { agent, events } = streamingAgent();

  agent.handleSingleEvent({
    event: LangGraphEventTypes.OnToolEnd,
    metadata: { langgraph_node: "tools" },
    data: {
      input: {},
      output: {
        type: "tool",
        id: "result",
        name: "get_current_time",
        tool_call_id: "clock",
        content: "2026-10-10T00:00:00Z",
      },
    },
  });

  assert.ok(events.every((event) => EventSchemas.safeParse(event).success));
  assert.deepEqual(
    events.map((event) => event.type),
    [
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
    ],
  );
});

test("sends only the resume command to Aegra", () => {
  const url = new URL("http://127.0.0.1:2026/threads/thread/runs/stream");
  const init = {
    method: "POST",
    body: JSON.stringify({
      input: { messages: [] },
      command: { resume: "approve" },
    }),
  };
  const result = prepareAegraRequest(url, init);
  const body = JSON.parse(result.body as string) as {
    command: unknown;
    input?: unknown;
  };

  assert.deepEqual(body.command, { resume: "approve" });
  assert.equal("input" in body, false);
});

class TestAgent extends ReviewLangGraphAgent {
  resumeValue(entries: readonly ResumeEntry[]): unknown {
    return this.buildCommandResumeFromAgui(entries, { openInterrupts: [] });
  }
}

test("resumes parallel reviews by LangGraph interrupt id", () => {
  const agent = new TestAgent({
    graphId: "agent",
    deploymentUrl: "http://127.0.0.1:2026",
  });

  assert.deepEqual(
    agent.resumeValue([
      {
        interruptId: "review-a",
        status: "resolved",
        payload: { decision: "approve" },
      },
      {
        interruptId: "review-b",
        status: "resolved",
        payload: { decision: "reject" },
      },
    ]),
    {
      "review-a": { decision: "approve" },
      "review-b": { decision: "reject" },
    },
  );
});

test("preserves the adapter's single-review resume value", () => {
  const agent = new TestAgent({
    graphId: "agent",
    deploymentUrl: "http://127.0.0.1:2026",
  });

  assert.deepEqual(
    agent.resumeValue([
      {
        interruptId: "review-a",
        status: "resolved",
        payload: { decision: "approve" },
      },
    ]),
    { decision: "approve" },
  );
});

test("a conversational decision targets its interrupt even when it is the only submitted review", () => {
  const agent = new TestAgent({
    graphId: "agent",
    deploymentUrl: "http://127.0.0.1:2026",
  });
  const payload = {
    action: "abandon",
    workflowCallId: "call",
    revision: 1,
    round: 1,
  };

  assert.deepEqual(
    agent.resumeValue([
      { interruptId: "sql-review", status: "resolved", payload },
    ]),
    { "sql-review": payload },
  );
});
