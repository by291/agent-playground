import { onTestFinished, test } from "vitest";
import { EventSchemas } from "@ag-ui/core/schemas";
import { EventType, type ResumeEntry } from "@ag-ui/client";
import { LangGraphEventTypes, type ProcessedEvents } from "@ag-ui/langgraph";
import assert from "node:assert/strict";
import { Observable } from "rxjs";
import { ReviewLangGraphAgent } from "./review-agent.js";
import { prepareAegraRequest } from "./aegra-client.js";

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

function interactionNodeEnd(messages: unknown[]) {
  return {
    event: LangGraphEventTypes.OnChainEnd,
    name: "InteractionMiddleware.after_model",
    metadata: { langgraph_node: "InteractionMiddleware.after_model" },
    data: { output: { messages } },
  };
}

test("native clarification receipts stream before the resumed model starts replying", () => {
  const { agent, events } = streamingAgent();
  const content = JSON.stringify({
    answers: [{ id: "style", answer: "Concise" }],
  });

  agent.handleSingleEvent(
    interactionNodeEnd([
      {
        type: "tool",
        id: "human-answer",
        name: "ask_user",
        tool_call_id: "question-call",
        content,
        status: "success",
      },
    ]),
  );

  assert.deepEqual(
    events.map((event) => event.type),
    [EventType.TOOL_CALL_RESULT],
  );
  assert.deepEqual(events[0], {
    type: EventType.TOOL_CALL_RESULT,
    toolCallId: "question-call",
    messageId: "human-answer",
    role: "tool",
    content,
  });
  agent.handleSingleEvent({
    event: LangGraphEventTypes.OnChatModelStream,
    metadata: { langgraph_node: "model" },
    data: {
      chunk: {
        id: "reply",
        content: "I received your preference.",
        response_metadata: {},
      },
    },
  });

  assert.ok(
    events.findIndex((event) => event.type === EventType.TOOL_CALL_RESULT) <
      events.findIndex(
        (event) => event.type === EventType.TEXT_MESSAGE_CONTENT,
      ),
  );
  assert.ok(events.every((event) => EventSchemas.safeParse(event).success));
});

test("native receipts deduplicate within one run and keep later runs independent", () => {
  const { agent, events } = streamingAgent();
  const event = interactionNodeEnd([
    {
      type: "tool",
      id: "answer",
      name: "ask_user",
      tool_call_id: "question",
      content: "Answer",
      status: "success",
    },
  ]);

  agent.handleSingleEvent(event);
  agent.handleSingleEvent(event);
  assert.equal(
    events.filter((item) => item.type === EventType.TOOL_CALL_RESULT).length,
    1,
  );
  assert.ok(agent.activeRun);
  agent.activeRun.id = "next-run";
  agent.handleSingleEvent(event);
  assert.equal(
    events.filter((item) => item.type === EventType.TOOL_CALL_RESULT).length,
    2,
  );
});

test("native receipt adaptation excludes errors, malformed messages and other chain outputs", () => {
  const { agent, events } = streamingAgent();
  const error = {
    type: "tool",
    id: "rejected",
    name: "ask_user",
    tool_call_id: "question",
    content: "User rejected the question",
    status: "error",
  };

  agent.handleSingleEvent(
    interactionNodeEnd([
      error,
      { type: "tool", tool_call_id: "missing-id", content: "Invalid" },
    ]),
  );
  agent.handleSingleEvent({
    ...interactionNodeEnd([{ ...error, status: "success" }]),
    name: "LangGraph",
  });
  agent.handleSingleEvent({
    ...interactionNodeEnd([{ ...error, status: "success" }]),
    metadata: { langgraph_node: "internal" },
  });

  assert.deepEqual(events, []);
});

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

test("resumed tool receipts without an embedded name retain the execution event's name", () => {
  const { agent, events } = streamingAgent();

  agent.handleSingleEvent({
    event: LangGraphEventTypes.OnToolEnd,
    name: "run_skill_script",
    metadata: { langgraph_node: "tools" },
    data: {
      input: { skill_name: "csv-summary" },
      output: {
        type: "tool",
        id: null,
        name: null,
        tool_call_id: "approved-script",
        content: '{"exitCode":0}',
        status: "success",
      },
    },
  });

  assert.ok(events.every((event) => EventSchemas.safeParse(event).success));
  assert.equal(events[0]?.type, EventType.TOOL_CALL_START);
  const start = events.find(
    (event) => event.type === EventType.TOOL_CALL_START,
  );

  assert.ok(start);
  assert.equal(start.toolCallId, "approved-script");
  assert.equal(start.toolCallName, "run_skill_script");
  assert.ok(events.some((event) => event.type === EventType.TOOL_CALL_RESULT));
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
