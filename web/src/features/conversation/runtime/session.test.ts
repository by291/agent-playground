import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import {
  WebTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-web";
import { setTimeout as delay } from "node:timers/promises";
import {
  HttpAgent,
  InterruptSchema,
  RunAgentInputSchema,
  type RunAgentInput,
} from "@ag-ui/client";
import { createConversationSession } from "./session";
import { isRunning, isRestoring } from "../model/selectors";
import { snapshotPolicy } from "../model/lifecycle";
import type { ConversationSnapshot } from "../api/contracts";
import {
  loadConversation,
  newConversation,
  saveConversation,
  type SavedConversation,
} from "../model/storage";
import type { A2UIOutput } from "@/features/a2ui";
import { chatTurns, toolProcess } from "../model/turns";
import {
  parseWorkflowReview,
  workflowReviewResponseSchema,
} from "@shared/workflow-review";

test("a resumed tool argument stream replaces saved arguments instead of appending them", async () => {
  const stream = streamingAgent("tool-resume");
  const session = createConversationSession(
    { threadId: "tool-resume" },
    stream.agent,
  );
  const interrupt = InterruptSchema.parse({
    id: "review",
    reason: "Review the plan",
    metadata: { langgraph: { raw: { workflowCallId: "plan" } } },
  });
  const interrupted: ConversationSnapshot = {
    messages: [
      { id: "question", role: "user", content: "Make a plan" },
      {
        id: "plan-request",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "plan",
            type: "function",
            function: {
              name: "run_experiment_workflow",
              arguments: '{"idea":"Old saved value"}',
            },
          },
        ],
      },
    ],
    interrupts: [interrupt],
    outputs: [],
    runs: [{ runId: "initial", messageId: "question", status: "interrupted" }],
  };
  const disconnect = connectSession(session, () =>
    Promise.resolve(interrupted),
  );

  session.receiveSnapshot(interrupted);
  const run = session.store.getState().reviewPlan([
    {
      interruptId: "review",
      decision: "approve",
      title: "Test",
      steps: ["Try"],
    },
  ]);
  const input = await stream.requested;

  stream.emit({
    type: "RUN_STARTED",
    threadId: "tool-resume",
    runId: input.runId,
  });
  stream.emit({
    type: "TOOL_CALL_START",
    toolCallId: "plan",
    toolCallName: "run_experiment_workflow",
    parentMessageId: "plan-request",
  });
  stream.emit({
    type: "TOOL_CALL_ARGS",
    toolCallId: "plan",
    delta: '{"idea":',
  });
  await delay(0);
  let caller = session.store
    .getState()
    .messages.find((message) => message.id === "plan-request");

  assert.ok(caller?.role === "assistant");
  assert.equal(caller.toolCalls?.[0]?.function.arguments, '{"idea":');
  stream.emit({ type: "TOOL_CALL_ARGS", toolCallId: "plan", delta: '"Test"}' });
  await delay(0);
  caller = session.store
    .getState()
    .messages.find((message) => message.id === "plan-request");

  assert.ok(caller?.role === "assistant");
  assert.equal(caller.toolCalls?.[0]?.function.arguments, '{"idea":"Test"}');
  stream.emit({ type: "TOOL_CALL_END", toolCallId: "plan" });
  stream.emit({
    type: "TOOL_CALL_RESULT",
    toolCallId: "plan",
    messageId: "result",
    role: "tool",
    content: "Approved",
  });
  stream.finish(input);
  await run;
  disconnect();
});

test("new tool calls accumulate each argument fragment while execution remains running", async () => {
  const stream = streamingAgent("new-tool");
  const session = createConversationSession(
    { threadId: "new-tool" },
    stream.agent,
  );
  const disconnect = connectSession(session, () => Promise.resolve(null));

  session.receiveSnapshot(null);
  const run = session.store.getState().send("Add 1 and 2");
  const input = await stream.requested;

  stream.emit({
    type: "RUN_STARTED",
    threadId: input.threadId,
    runId: input.runId,
  });
  stream.emit({
    type: "TOOL_CALL_START",
    toolCallId: "sum",
    toolCallName: "calculate_sum",
    parentMessageId: "caller",
  });
  stream.emit({ type: "TOOL_CALL_ARGS", toolCallId: "sum", delta: '{"a":1,' });
  await delay(0);
  let caller = session.store
    .getState()
    .messages.find((message) => message.id === "caller");

  assert.ok(caller?.role === "assistant");
  assert.equal(caller.toolCalls?.[0]?.function.arguments, '{"a":1,');
  stream.emit({ type: "TOOL_CALL_ARGS", toolCallId: "sum", delta: '"b":2}' });
  stream.emit({ type: "TOOL_CALL_END", toolCallId: "sum" });
  await delay(0);
  caller = session.store
    .getState()
    .messages.find((message) => message.id === "caller");

  assert.ok(caller?.role === "assistant");
  assert.equal(caller.toolCalls?.[0]?.function.arguments, '{"a":1,"b":2}');
  assert.equal(session.store.getState().runs.at(-1)?.status, "running");
  stream.emit({
    type: "TOOL_CALL_RESULT",
    toolCallId: "sum",
    messageId: "result",
    role: "tool",
    content: "3",
  });
  stream.finish(input);
  await run;
  disconnect();
});

test("a handled tool error is visible before the model finishes its fallback reply", async () => {
  const stream = streamingAgent("handled-error");
  const session = createConversationSession(
    { threadId: "handled-error" },
    stream.agent,
  );
  const disconnect = connectSession(session, () => Promise.resolve(null));

  session.receiveSnapshot(null);
  const run = session.store.getState().send("Create a plan");
  const input = await stream.requested;

  stream.emit({
    type: "RUN_STARTED",
    threadId: input.threadId,
    runId: input.runId,
  });
  stream.emit({
    type: "TOOL_CALL_START",
    toolCallId: "plan",
    toolCallName: "run_experiment_workflow",
    parentMessageId: "caller",
  });
  stream.emit({ type: "TOOL_CALL_ARGS", toolCallId: "plan", delta: "{}" });
  stream.emit({ type: "TOOL_CALL_END", toolCallId: "plan" });
  // The LangGraph adapter does not emit TOOL_CALL_RESULT for handled errors.
  stream.emit({
    type: "STATE_SNAPSHOT",
    snapshot: {
      toolErrors: [
        {
          id: "error",
          role: "tool",
          toolCallId: "plan",
          content: "Missing idea",
          error: "Missing idea",
        },
      ],
    },
  });
  await delay(0);
  const state = session.store.getState();
  const turn = chatTurns(state.messages, state.runs)[0]!;

  assert.equal(isRunning(state), true);
  assert.equal(toolProcess(turn)[0]?.calls[0]?.status, "failed");
  assert.equal(toolProcess(turn)[0]?.calls[0]?.result?.error, "Missing idea");
  stream.emit({
    type: "TEXT_MESSAGE_START",
    messageId: "fallback",
    role: "assistant",
  });
  stream.emit({
    type: "TEXT_MESSAGE_CONTENT",
    messageId: "fallback",
    delta: "Please provide an idea.",
  });
  stream.emit({ type: "TEXT_MESSAGE_END", messageId: "fallback" });
  stream.finish(input);
  await run;
  disconnect();
});

const savedValues = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => savedValues.get(key) ?? null,
    setItem: (key: string, value: string) => savedValues.set(key, value),
  },
  configurable: true,
});

function connectSession(
  session: ReturnType<typeof createConversationSession>,
  fetchSnapshot: () => Promise<ConversationSnapshot | null>,
) {
  return session.connect(async () => {
    try {
      session.receiveSnapshot(await fetchSnapshot());
    } catch (error) {
      session.receiveSnapshotError(error);
      throw error;
    }
  });
}

function snapshot(
  runId = "old-run",
  status: import("@shared/run-status").RunStatus = "completed",
): ConversationSnapshot {
  return {
    messages: [
      { id: "saved-message", role: "assistant", content: "Saved reply" },
    ],
    outputs: [],
    interrupts: [],
    runs: [{ runId, status }],
  };
}

function streamingAgent(threadId: string) {
  let resolveRequest: (input: RunAgentInput) => void;
  const requested = new Promise<RunAgentInput>((resolve) => {
    resolveRequest = resolve;
  });
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let requests = 0;
  const agent = new HttpAgent({
    threadId,
    url: "/agent",
    fetch: (_url, init) => {
      requests += 1;
      assert.equal(typeof init.body, "string");
      const input = RunAgentInputSchema.parse(JSON.parse(init.body as string));

      resolveRequest(input);
      const body = new ReadableStream<Uint8Array>({
        start(next) {
          controller = next;
        },
      });

      return Promise.resolve(
        new Response(body, {
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    },
  });

  return {
    agent,
    requested,

    get requests() {
      return requests;
    },

    emit(event: Record<string, unknown>) {
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
      );
    },

    finish(input: RunAgentInput) {
      this.emit({ type: "RUN_FINISHED", threadId, runId: input.runId });
      controller.close();
    },
  };
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1000;

  while (!predicate() && Date.now() < deadline) {
    await delay(1);
  }

  assert.ok(predicate(), "Expected conversation state was not reached");
}

test("activity captures received payloads, timestamps and run ownership including state snapshots", async () => {
  const stream = streamingAgent("diagnostics");
  const session = createConversationSession(
    { threadId: "diagnostics", fresh: true, empty: true },
    stream.agent,
  );
  const disconnect = connectSession(session, () => Promise.resolve(null));
  const startedAt = Date.now();
  const run = session.store.getState().send("Inspect this run");
  const input = await stream.requested;

  stream.emit({
    type: "RUN_STARTED",
    threadId: input.threadId,
    runId: input.runId,
  });
  stream.emit({ type: "STEP_STARTED", stepName: "model" });
  stream.emit({
    type: "STATE_SNAPSHOT",
    snapshot: { diagnostic: "saved state" },
  });
  stream.emit({ type: "STEP_FINISHED", stepName: "model" });
  stream.finish(input);
  await run;
  const state = session.store.getState();

  assert.equal(state.activityReceived, 5);
  assert.equal(state.activity.length, 5);
  assert.deepEqual(
    state.activity.map((entry) => entry.event.type),
    [
      "RUN_FINISHED",
      "STEP_FINISHED",
      "STATE_SNAPSHOT",
      "STEP_STARTED",
      "RUN_STARTED",
    ],
  );
  assert.deepEqual(state.activity[2]?.event, {
    type: "STATE_SNAPSHOT",
    snapshot: { diagnostic: "saved state" },
  });

  for (const entry of state.activity) {
    assert.equal(entry.runId, input.runId);
    assert.ok(entry.receivedAt >= startedAt && entry.receivedAt <= Date.now());
  }

  disconnect();
});

test("activity bounds retained events without capping the received count and can clear without resetting the run", async () => {
  const stream = streamingAgent("diagnostic-limit");
  const session = createConversationSession(
    { threadId: "diagnostic-limit", fresh: true, empty: true },
    stream.agent,
  );
  const disconnect = connectSession(session, () => Promise.resolve(null));
  const run = session.store.getState().send("Inspect many events");
  const input = await stream.requested;

  stream.emit({
    type: "RUN_STARTED",
    threadId: input.threadId,
    runId: input.runId,
  });

  for (let index = 0; index < 505; index += 1) {
    stream.emit({ type: "CUSTOM", name: "diagnostic", value: { index } });
  }

  await waitFor(() => session.store.getState().activityReceived === 506);
  const state = session.store.getState();

  assert.equal(state.activity.length, 500);
  assert.deepEqual(state.activity[0]?.event, {
    type: "CUSTOM",
    name: "diagnostic",
    value: { index: 504 },
  });
  assert.deepEqual(state.activity.at(-1)?.event.value, { index: 5 });
  state.clearActivity();
  assert.equal(session.store.getState().activityReceived, 0);
  assert.deepEqual(session.store.getState().activity, []);
  assert.equal(isRunning(session.store.getState()), true);
  stream.finish(input);
  await run;
  assert.equal(session.store.getState().activityReceived, 1);
  assert.equal(session.store.getState().activity[0]?.runId, input.runId);
  disconnect();
});

test("a fresh conversation can submit before its first snapshot and syncs after the run", async () => {
  const conversation = newConversation();
  const stream = streamingAgent(conversation.threadId);
  const session = createConversationSession(conversation, stream.agent);
  let reads = 0;
  let savedSnapshot: ConversationSnapshot | null = null;
  const disconnect = connectSession(session, () => {
    reads += 1;

    return Promise.resolve(savedSnapshot);
  });

  try {
    assert.equal(isRestoring(session.store.getState()), false);
    assert.equal(
      snapshotPolicy(session.store.getState().lifecycle).enabled,
      false,
    );
    const completion = session.store.getState().send("Hello");
    const input = await stream.requested;

    assert.equal(input.messages[0]?.content, "Hello");
    assert.equal(reads, 0);
    assert.equal(
      snapshotPolicy(session.store.getState().lifecycle).enabled,
      false,
    );
    savedSnapshot = snapshot(input.runId);
    stream.emit({
      type: "RUN_STARTED",
      threadId: input.threadId,
      runId: input.runId,
    });
    stream.finish(input);
    await completion;
    assert.equal(reads, 1);
    assert.equal(
      snapshotPolicy(session.store.getState().lifecycle).enabled,
      true,
    );
    assert.equal(
      snapshotPolicy(session.store.getState().lifecycle).polling,
      false,
    );
    assert.equal(session.store.getState().messages[0]?.content, "Saved reply");
  } finally {
    disconnect();
  }
});

test("restoring an empty conversation still requires a snapshot before sending", async () => {
  const conversation = newConversation();

  saveConversation(conversation);
  assert.deepEqual(
    JSON.parse(localStorage.getItem("agent-playground-conversation")!),
    { threadId: conversation.threadId, empty: true },
    "Only durable conversation fields are saved",
  );
  const restored = loadConversation();
  const stream = streamingAgent(restored.threadId);
  const session = createConversationSession(restored, stream.agent);
  const disconnect = connectSession(session, () => Promise.resolve(null));

  try {
    assert.equal(isRestoring(session.store.getState()), true);
    assert.equal(
      snapshotPolicy(session.store.getState().lifecycle).enabled,
      true,
    );
    await session.store.getState().send("Wait for recovery");
    assert.equal(stream.requests, 0);
    session.receiveSnapshot(null);
    assert.equal(isRestoring(session.store.getState()), false);
  } finally {
    disconnect();
  }
});

test("snapshot polling stops for idle and terminal runs and follows unfinished recovery", () => {
  const session = createConversationSession({ threadId: "polling-recovery" });
  const disconnect = connectSession(session, () => Promise.resolve(null));

  try {
    session.receiveSnapshot(null);
    assert.equal(
      snapshotPolicy(session.store.getState().lifecycle).polling,
      false,
    );

    for (const status of [
      "prepared",
      "dispatching",
      "running",
      "submission_unknown",
    ] as const) {
      session.receiveSnapshot(snapshot("recovered-run", status));
      assert.equal(
        snapshotPolicy(session.store.getState().lifecycle).polling,
        true,
        status,
      );
    }

    for (const status of ["completed", "failed", "interrupted"] as const) {
      session.receiveSnapshot(snapshot("recovered-run", status));
      assert.equal(
        snapshotPolicy(session.store.getState().lifecycle).polling,
        false,
        status,
      );
    }
  } finally {
    disconnect();
  }
});

test("a failed initial snapshot enables recovery until a successful fetch", () => {
  const session = createConversationSession({ threadId: "polling-error" });
  const disconnect = connectSession(session, () => Promise.resolve(null));

  try {
    session.receiveSnapshotError(new Error("Gateway unavailable"));
    assert.equal(
      snapshotPolicy(session.store.getState().lifecycle).polling,
      true,
    );
    session.receiveSnapshot(null);
    assert.equal(
      snapshotPolicy(session.store.getState().lifecycle).polling,
      false,
    );
    assert.equal(session.store.getState().issues.snapshot, null);
  } finally {
    disconnect();
  }
});

test("live SSE suppresses polling and a failed final sync resumes recovery", async () => {
  const stream = streamingAgent("polling-stream");
  const session = createConversationSession(
    { threadId: "polling-stream" },
    stream.agent,
  );
  let reads = 0;
  const disconnect = connectSession(session, () => {
    reads += 1;

    return Promise.reject(new Error("Final snapshot unavailable"));
  });

  try {
    session.receiveSnapshot(null);
    const run = session.store.getState().send("Hello");
    const input = await stream.requested;
    const duringSubmission = snapshotPolicy(
      session.store.getState().lifecycle,
    ).polling;

    stream.emit({
      type: "RUN_STARTED",
      threadId: input.threadId,
      runId: input.runId,
    });
    session.receiveSnapshot(snapshot(input.runId, "running"));
    const duringStream = snapshotPolicy(
      session.store.getState().lifecycle,
    ).polling;

    session.receiveSnapshotError(new Error("Focus refresh unavailable"));
    const afterRefreshError = snapshotPolicy(
      session.store.getState().lifecycle,
    ).polling;

    stream.finish(input);
    await run;
    assert.equal(
      reads,
      1,
      "A settled stream immediately requests one snapshot",
    );
    assert.equal(duringSubmission, false);
    assert.equal(duringStream, false);
    assert.equal(afterRefreshError, false);
    assert.equal(
      snapshotPolicy(session.store.getState().lifecycle).polling,
      true,
    );

    session.receiveSnapshot(snapshot(input.runId));
    assert.equal(
      snapshotPolicy(session.store.getState().lifecycle).polling,
      false,
    );
    assert.equal(isRunning(session.store.getState()), false);
    assert.equal(session.store.getState().messages[0]?.content, "Saved reply");
  } finally {
    disconnect();
  }
});

test("a stale final snapshot keeps recovery enabled until the current run is saved", async () => {
  const stream = streamingAgent("polling-stale");
  const session = createConversationSession(
    { threadId: "polling-stale" },
    stream.agent,
  );
  const previous = snapshot();
  const disconnect = connectSession(session, () => Promise.resolve(previous));

  try {
    session.receiveSnapshot(previous);
    const run = session.store.getState().send("Hello");
    const input = await stream.requested;

    stream.emit({
      type: "RUN_STARTED",
      threadId: input.threadId,
      runId: input.runId,
    });
    stream.finish(input);
    await run;
    assert.equal(
      snapshotPolicy(session.store.getState().lifecycle).polling,
      true,
    );

    session.receiveSnapshot(snapshot(input.runId, "running"));
    assert.equal(
      snapshotPolicy(session.store.getState().lifecycle).polling,
      true,
    );
    session.receiveSnapshot(snapshot(input.runId));
    assert.equal(
      snapshotPolicy(session.store.getState().lifecycle).polling,
      false,
    );
  } finally {
    disconnect();
  }
});

test("a saved A2UI sequence gap keeps recovery enabled until missing output arrives", () => {
  const session = createConversationSession({ threadId: "polling-output-gap" });
  const disconnect = connectSession(session, () => Promise.resolve(null));
  const first: A2UIOutput = {
    id: "create",
    outputSeq: 1,
    messages: [
      {
        version: "v0.9",
        createSurface: {
          surfaceId: "gap",
          catalogId: "urn:agent-playground:workflow:v1",
        },
      },
    ],
  };
  const second: A2UIOutput = {
    id: "delete",
    outputSeq: 2,
    messages: [{ version: "v0.9", deleteSurface: { surfaceId: "gap" } }],
  };

  try {
    session.receiveSnapshot({ ...snapshot(), outputs: [second] });
    assert.equal(
      snapshotPolicy(session.store.getState().lifecycle).polling,
      true,
    );
    session.receiveSnapshot({ ...snapshot(), outputs: [first, second] });
    assert.equal(
      snapshotPolicy(session.store.getState().lifecycle).polling,
      false,
    );
    assert.equal(session.store.getState().issues.output, null);
  } finally {
    disconnect();
  }
});

describe("restoring a saved conversation never publishes a completed empty state", () => {
  const savedText = snapshot();
  const savedSurface: ConversationSnapshot = {
    ...snapshot(),
    messages: [],
    outputs: [
      {
        id: "saved-output",
        outputSeq: 1,
        messages: [
          {
            version: "v0.9",
            createSurface: {
              surfaceId: "main",
              catalogId: "urn:agent-playground:workflow:v1",
            },
          },
        ],
      },
    ],
  };

  for (const [name, saved] of [
    ["text history", savedText],
    ["surface history", savedSurface],
  ] as const) {
    test(name, () => {
      const session = createConversationSession({ threadId: name });
      const disconnect = connectSession(session, () => Promise.resolve(saved));
      const completedStates: { messages: number; surfaces: number }[] = [];
      const unsubscribe = session.store.subscribe((state) => {
        if (!isRestoring(state)) {
          completedStates.push({
            messages: state.messages.length,
            surfaces: state.surfaces.length,
          });
        }
      });

      try {
        session.receiveSnapshot(saved);
        assert.ok(completedStates.length > 0);

        for (const state of completedStates) {
          assert.ok(
            state.messages > 0 || state.surfaces > 0,
            "Recovery must install saved content before allowing the welcome screen",
          );
        }

        const savedPointer = JSON.parse(
          localStorage.getItem("agent-playground-conversation") ?? "null",
        ) as SavedConversation;

        assert.equal(savedPointer.empty, false);
      } finally {
        unsubscribe();
        disconnect();
      }
    });
  }
});

test("an empty conversation finishes recovery without inventing history", () => {
  const session = createConversationSession({ threadId: "empty-thread" });
  const disconnect = connectSession(session, () => Promise.resolve(null));

  try {
    session.receiveSnapshot(null);
    assert.equal(isRestoring(session.store.getState()), false);
    assert.deepEqual(session.store.getState().messages, []);
    assert.deepEqual(session.store.getState().surfaces, []);
    assert.deepEqual(session.store.getState().pendingInterrupts, []);
    const saved = JSON.parse(
      localStorage.getItem("agent-playground-conversation") ?? "null",
    ) as SavedConversation;

    assert.equal(saved.empty, true);
  } finally {
    disconnect();
  }
});

test("a rejected submission unlocks an existing conversation without discarding its pending input", async () => {
  const inputs: RunAgentInput[] = [];
  const agent = new HttpAgent({
    threadId: "rejected-thread",
    url: "/agent",
    fetch: (_url, init) => {
      assert.equal(typeof init.body, "string");
      inputs.push(RunAgentInputSchema.parse(JSON.parse(init.body as string)));

      return Promise.reject(new Error("Request failed before admission"));
    },
  });
  const session = createConversationSession(
    { threadId: "rejected-thread" },
    agent,
  );
  const previous = snapshot();
  const disconnect = connectSession(session, () => Promise.resolve(previous));

  try {
    session.receiveSnapshot(previous);
    await session.store.getState().send("Keep this pending input");

    assert.equal(agent.isRunning, false);
    assert.equal(isRunning(session.store.getState()), false);
    assert.equal(
      snapshotPolicy(session.store.getState().lifecycle).polling,
      false,
    );
    assert.match(session.store.getState().issues.run ?? "", /admission/i);
    assert.equal(
      session.store.getState().messages.at(-1)?.content,
      "Keep this pending input",
    );
    const saved = JSON.parse(
      localStorage.getItem("agent-playground-conversation") ?? "null",
    ) as SavedConversation;

    assert.equal(saved.pending?.runId, inputs[0]?.runId);
    assert.equal(saved.empty, false);
    assert.equal(inputs[0]?.messages.length, 1);
    assert.deepEqual(saved.pending?.messages.at(-1), inputs[0]?.messages[0]);
    assert.equal(saved.pending?.messages[0]?.id, "saved-message");

    session.receiveSnapshot(previous);
    assert.equal(isRunning(session.store.getState()), false);
    assert.equal(inputs.length, 1);
    await session.store.getState().send("Another attempt");
    assert.equal(inputs.length, 2);
  } finally {
    disconnect();
  }
});

test("a stale completed snapshot cannot erase a new stream or leak into another session", async () => {
  const stream = streamingAgent("thread-one");
  const first = createConversationSession(
    { threadId: "thread-one" },
    stream.agent,
  );
  const second = createConversationSession({ threadId: "thread-two" });
  let finalSnapshot = snapshot();
  const disconnect = connectSession(first, () =>
    Promise.resolve(finalSnapshot),
  );
  const disconnectSecond = connectSession(second, () => Promise.resolve(null));

  try {
    first.receiveSnapshot(snapshot());
    second.receiveSnapshot(null);
    const completion = first.store.getState().send("New question");
    const input = await stream.requested;

    stream.emit({
      type: "RUN_STARTED",
      threadId: input.threadId,
      runId: input.runId,
    });
    stream.emit({
      type: "TEXT_MESSAGE_START",
      messageId: "stream-message",
      role: "assistant",
    });
    stream.emit({
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "stream-message",
      delta: "Live reply",
    });
    await waitFor(
      () => first.store.getState().messages.at(-1)?.content === "Live reply",
    );

    first.receiveSnapshot(snapshot());
    assert.equal(first.store.getState().messages.at(-1)?.content, "Live reply");
    assert.equal(isRunning(first.store.getState()), true);
    assert.deepEqual(second.store.getState().messages, []);
    assert.deepEqual(second.store.getState().activity, []);

    finalSnapshot = snapshot(input.runId);
    finalSnapshot.messages = [
      { id: "checkpoint-message", role: "assistant", content: "Final reply" },
    ];
    first.receiveSnapshot(finalSnapshot);
    assert.equal(first.store.getState().messages.at(-1)?.id, "stream-message");
    assert.equal(
      first.store
        .getState()
        .messages.some((message) => message.id === "checkpoint-message"),
      false,
    );
    stream.emit({ type: "TEXT_MESSAGE_END", messageId: "stream-message" });
    stream.finish(input);
    await completion;
    assert.deepEqual(first.store.getState().messages, finalSnapshot.messages);
    assert.equal(isRunning(first.store.getState()), false);
  } finally {
    disconnect();
    disconnectSecond();
  }
});

test("reload retries a prepared submission once with the original input", async () => {
  const stream = streamingAgent("retry-thread");
  const saved: SavedConversation = {
    threadId: "retry-thread",
    pending: {
      runId: "original-run",
      messageId: "original-message",
      messages: [
        { id: "original-message", role: "user", content: "Original input" },
      ],
      state: { selected: "original" },
    },
  };
  const session = createConversationSession(saved, stream.agent);
  const disconnect = connectSession(session, () =>
    Promise.resolve(snapshot("original-run")),
  );

  try {
    session.receiveSnapshot(snapshot("original-run", "prepared"));
    session.receiveSnapshot(snapshot("original-run", "prepared"));
    const input = await stream.requested;

    assert.equal(input.runId, "original-run");
    assert.deepEqual(input.messages, saved.pending?.messages);
    assert.deepEqual(input.state, { selected: "original" });
    assert.equal(stream.requests, 1);
    stream.emit({
      type: "RUN_STARTED",
      threadId: input.threadId,
      runId: input.runId,
    });
    stream.finish(input);
    await waitFor(() => !isRunning(session.store.getState()));
  } finally {
    disconnect();
  }
});

test("context usage streams and recovers without replaying archived messages", async () => {
  const stream = streamingAgent("context-thread");
  const session = createConversationSession(
    { threadId: "context-thread" },
    stream.agent,
  );
  const initial = snapshot();
  const usage = {
    model: "deepseek-flash",
    usedTokens: 1200,
    contextWindow: 1000000,
    triggerTokens: 800000,
    breakdown: {
      system: 100,
      tools: 200,
      conversation: 300,
      toolResults: 100,
      summary: 500,
    },
    lastInputTokens: 1600,
    compactions: 1,
    lastCompaction: { beforeTokens: 810000, afterTokens: 1200 },
    revision: 4,
  };
  const disconnect = connectSession(session, () => Promise.resolve(initial));

  try {
    session.receiveSnapshot(initial);
    const completion = session.store.getState().send("Continue");
    const input = await stream.requested;

    assert.equal(input.messages.length, 1);
    assert.equal(input.messages[0]?.role, "user");
    assert.equal(session.store.getState().messages[0]?.id, "saved-message");
    stream.emit({
      type: "RUN_STARTED",
      threadId: input.threadId,
      runId: input.runId,
    });
    stream.emit({ type: "STATE_SNAPSHOT", snapshot: { context_usage: usage } });
    await waitFor(() => session.store.getState().contextUsage?.revision === 4);
    assert.deepEqual(session.store.getState().contextUsage, usage);

    const stale = {
      ...initial,
      runs: [{ runId: input.runId, status: "running" as const }],
      contextUsage: { ...usage, revision: 2 },
    };

    session.receiveSnapshot(stale);
    assert.equal(session.store.getState().contextUsage?.revision, 4);
    stream.finish(input);
    await completion;
    session.receiveSnapshot({
      ...initial,
      runs: [{ runId: input.runId, status: "completed" }],
      contextUsage: usage,
    });
    assert.deepEqual(session.store.getState().contextUsage, usage);
  } finally {
    disconnect();
  }
});

test.each([false, true])(
  "an uncertain snapshot cannot override an active local request (stream started: %s)",
  async (started) => {
    const stream = streamingAgent("live-uncertainty");
    const session = createConversationSession(
      { threadId: "live-uncertainty" },
      stream.agent,
    );
    const disconnect = connectSession(session, () => Promise.resolve(null));

    session.receiveSnapshot(null);
    const completion = session.store.getState().send("What time is it?");
    const input = await stream.requested;

    try {
      if (started) {
        stream.emit({
          type: "RUN_STARTED",
          threadId: input.threadId,
          runId: input.runId,
        });
        await delay(0);
      }

      session.receiveSnapshot(snapshot(input.runId, "submission_unknown"));
      const state = session.store.getState();

      assert.equal(state.issues.run, null);
      assert.equal(state.runs.at(-1)?.status, "running");
      assert.equal(isRunning(state), true);
      await state.send("Must not submit another request");
      assert.equal(stream.requests, 1);

      session.receiveSnapshot(snapshot(input.runId, "running"));
      assert.equal(session.store.getState().issues.run, null);
    } finally {
      stream.finish(input);
      await completion;
      disconnect();
    }
  },
);

test("an unknown server submission is recovered without resending it", () => {
  const stream = streamingAgent("unknown-thread");
  const session = createConversationSession(
    {
      threadId: "unknown-thread",
      pending: {
        runId: "unknown-run",
        messageId: "message",
        messages: [],
        state: {},
      },
    },
    stream.agent,
  );
  const disconnect = connectSession(session, () => Promise.resolve(null));

  try {
    session.receiveSnapshot(snapshot("unknown-run", "submission_unknown"));
    assert.equal(stream.requests, 0);
    assert.equal(isRestoring(session.store.getState()), false);
    assert.match(session.store.getState().issues.run ?? "", /unknown/i);
  } finally {
    disconnect();
  }
});

test("repeated outputs share the same surface and conflicts remain visible", () => {
  const session = createConversationSession({ threadId: "card-thread" });
  const disconnect = connectSession(session, () => Promise.resolve(null));

  try {
    const initial = snapshot();

    initial.outputs = [
      {
        id: "output",
        outputSeq: 1,
        messages: [
          {
            version: "v0.9",
            createSurface: {
              surfaceId: "main",
              catalogId: "urn:agent-playground:workflow:v1",
            },
          },
        ],
      },
    ];
    session.receiveSnapshot(initial);
    const surface = session.store.getState().surfaces[0]!.surface;

    session.receiveSnapshot(initial);
    assert.equal(session.store.getState().surfaces.length, 1);
    assert.equal(session.store.getState().surfaces[0]!.surface, surface);
    session.receiveSnapshot({
      ...initial,
      outputs: [{ ...initial.outputs[0]!, messages: [] }],
    });
    assert.equal(session.store.getState().surfaces[0]!.surface, surface);
    assert.match(session.store.getState().issues.output ?? "", /conflicting/i);
  } finally {
    disconnect();
  }
});

test("disconnect prevents late recovery from overwriting the new conversation pointer", () => {
  const stream = streamingAgent("old-thread");
  const session = createConversationSession(
    {
      threadId: "old-thread",
      pending: {
        runId: "old-run",
        messageId: "message",
        messages: [],
        state: {},
      },
    },
    stream.agent,
  );
  const disconnect = connectSession(session, () => Promise.resolve(null));

  disconnect();
  localStorage.setItem(
    "agent-playground-conversation",
    JSON.stringify({ threadId: "new-thread" }),
  );
  session.receiveSnapshot(snapshot("old-run"));
  assert.equal(stream.requests, 0);
  assert.deepEqual(
    JSON.parse(localStorage.getItem("agent-playground-conversation") ?? "null"),
    { threadId: "new-thread" },
  );
});

test("out-of-order live A2UI updates recover through a snapshot and do not replay on completion", async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new WebTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  trace.setGlobalTracerProvider(provider);
  const stream = streamingAgent("output-thread");
  const session = createConversationSession(
    { threadId: "output-thread" },
    stream.agent,
  );
  const first: A2UIOutput = {
    id: "created",
    outputSeq: 1,
    messages: [
      {
        version: "v0.9",
        createSurface: {
          surfaceId: "main",
          catalogId: "urn:agent-playground:workflow:v1",
        },
      },
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
    ],
  };
  const second: A2UIOutput = {
    id: "updated",
    outputSeq: 2,
    messages: [
      {
        version: "v0.9",
        updateDataModel: {
          surfaceId: "main",
          path: "/title",
          value: "Recovered update",
        },
      },
    ],
  };
  let reads = 0;
  let recovered = snapshot();

  recovered.outputs = [first, second];
  const disconnect = connectSession(session, () => {
    reads += 1;

    return Promise.resolve(recovered);
  });

  try {
    session.receiveSnapshot(null);
    const completion = session.store.getState().send("Show a surface");
    const input = await stream.requested;

    stream.emit({
      type: "RUN_STARTED",
      threadId: input.threadId,
      runId: input.runId,
    });
    stream.emit({ type: "CUSTOM", name: "a2ui", value: second });
    stream.emit({ type: "CUSTOM", name: "a2ui", value: second });
    await waitFor(() => session.store.getState().surfaces.length === 1);
    assert.equal(reads, 1);
    const surface = session.store.getState().surfaces[0]!.surface;

    assert.equal(surface.dataModel.get("/title"), "Recovered update");
    assert.equal(session.store.getState().issues.output, null);
    recovered = {
      ...recovered,
      runs: [{ runId: input.runId, status: "completed" }],
    };
    stream.finish(input);
    await completion;
    const span = exporter
      .getFinishedSpans()
      .find((item) => item.name === "web.submit");

    assert.ok(span);
    assert.notEqual(span.status.code, SpanStatusCode.ERROR);
    assert.equal(span.attributes["app.stream.outcome"], "finished");
    assert.equal(session.store.getState().surfaces[0]!.surface, surface);
    assert.equal(session.store.getState().issues.output, null);
    disconnect();
    const reconnect = connectSession(session, () => Promise.resolve(recovered));

    session.receiveSnapshot(recovered);
    assert.notEqual(session.store.getState().surfaces[0]!.surface, surface);
    assert.equal(
      session.store.getState().surfaces[0]!.surface.dataModel.get("/title"),
      "Recovered update",
    );
    reconnect();
  } finally {
    disconnect();
    trace.disable();
    await provider.shutdown();
  }
});

test("invalid A2UI events remain visible without interrupting the text stream", async () => {
  const stream = streamingAgent("invalid-output-thread");
  const session = createConversationSession(
    { threadId: "invalid-output-thread" },
    stream.agent,
  );
  const disconnect = connectSession(session, () => Promise.resolve(snapshot()));

  try {
    session.receiveSnapshot(null);
    const completion = session.store.getState().send("Keep streaming");
    const input = await stream.requested;

    stream.emit({
      type: "RUN_STARTED",
      threadId: input.threadId,
      runId: input.runId,
    });
    stream.emit({
      type: "CUSTOM",
      name: "a2ui",
      value: { kind: "a2ui", messages: [] },
    });
    stream.emit({
      type: "TEXT_MESSAGE_START",
      messageId: "reply",
      role: "assistant",
    });
    stream.emit({
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "reply",
      delta: "Still streaming",
    });
    await waitFor(
      () =>
        session.store.getState().messages.at(-1)?.content === "Still streaming",
    );
    assert.match(
      session.store.getState().issues.output ?? "",
      /Invalid A2UI output/i,
    );
    stream.emit({ type: "TEXT_MESSAGE_END", messageId: "reply" });
    stream.finish(input);
    await completion;
    assert.match(
      session.store.getState().issues.output ?? "",
      /Invalid A2UI output/i,
    );
  } finally {
    disconnect();
  }
});

test("review submission covers each interrupt once and blocks duplicate sends", async () => {
  const stream = streamingAgent("review-thread");
  const session = createConversationSession(
    { threadId: "review-thread" },
    stream.agent,
  );
  let finalSnapshot = snapshot();
  const disconnect = connectSession(session, () =>
    Promise.resolve(finalSnapshot),
  );

  try {
    const reviewSnapshot = snapshot("paused-run", "interrupted");

    reviewSnapshot.interrupts = [
      InterruptSchema.parse({ id: "review-a", reason: "Review draft A" }),
      InterruptSchema.parse({ id: "review-b", reason: "Review draft B" }),
    ];
    session.receiveSnapshot(reviewSnapshot);
    await session.store.getState().send("Cannot bypass the review");
    const answerA = {
      interruptId: "review-a",
      decision: "approve" as const,
      title: "Edited A",
      steps: ["Step A"],
    };
    const answerB = {
      interruptId: "review-b",
      decision: "reject" as const,
      title: "Edited B",
      steps: ["Step B"],
    };

    await session.store.getState().reviewPlan([answerA, answerA]);
    assert.equal(stream.requests, 0);

    const completion = session.store.getState().reviewPlan([answerA, answerB]);

    await session.store.getState().reviewPlan([answerA, answerB]);
    const input = await stream.requested;

    assert.equal(stream.requests, 1);
    assert.deepEqual(input.resume, [
      {
        interruptId: "review-a",
        status: "resolved",
        payload: { decision: "approve", title: "Edited A", steps: ["Step A"] },
      },
      {
        interruptId: "review-b",
        status: "resolved",
        payload: { decision: "reject", title: "Edited B", steps: ["Step B"] },
      },
    ]);
    finalSnapshot = snapshot(input.runId);
    stream.emit({
      type: "RUN_STARTED",
      threadId: input.threadId,
      runId: input.runId,
    });
    stream.finish(input);
    await completion;
    assert.deepEqual(session.store.getState().pendingInterrupts, []);
  } finally {
    disconnect();
  }
});

test("non-SQL review feedback resumes its workflow rather than starting an ordinary turn", async () => {
  const stream = streamingAgent("copy-feedback");
  const session = createConversationSession(
    { threadId: "copy-feedback" },
    stream.agent,
  );
  const paused = snapshot("copy-initial", "interrupted");

  paused.interrupts = [
    InterruptSchema.parse({
      id: "copy-review",
      reason: "Review copy",
      metadata: {
        langgraph: {
          raw: {
            kind: "workflow_review",
            workflowCallId: "copy-call",
            revision: 2,
            round: 3,
            outputStepId: "review:3",
            canAccept: true,
          },
        },
      },
    }),
  ];
  const disconnect = connectSession(session, () => Promise.resolve(paused));

  try {
    session.receiveSnapshot(paused);
    const completion = session.store.getState().send("Make the copy shorter");

    const input = await stream.requested;

    assert.equal(stream.requests, 1);
    assert.deepEqual(input.messages, []);
    assert.equal(input.resume?.[0]?.interruptId, "copy-review");
    assert.equal(
      (input.resume?.[0]?.payload as { message: string }).message,
      "Make the copy shorter",
    );
    stream.emit({
      type: "RUN_STARTED",
      runId: input.runId,
      threadId: input.threadId,
    });
    stream.finish(input);
    await completion;
  } finally {
    disconnect();
  }
});

test("SQL feedback resumes the current workflow and stale or failed acceptance does not send", async () => {
  const stream = streamingAgent("sql-feedback");
  const session = createConversationSession(
    { threadId: "sql-feedback" },
    stream.agent,
  );
  const paused = snapshot("sql-initial", "interrupted");
  const interrupt = InterruptSchema.parse({
    id: "sql-review",
    reason: "Review SQL",
    metadata: {
      langgraph: {
        raw: {
          kind: "workflow_review",
          workflowCallId: "sql-call",
          revision: 2,
          round: 3,
          outputStepId: "review:3",
          canAccept: false,
          title: "SQL decision",
          blockedReason: "Fix the query",
        },
      },
    },
  });

  paused.interrupts = [interrupt];
  const disconnect = connectSession(session, () => Promise.resolve(paused));

  try {
    session.receiveSnapshot(paused);
    const review = parseWorkflowReview(interrupt)!;

    await session.store.getState().reviewWorkflow(review, "accept");
    await session.store
      .getState()
      .reviewWorkflow({ ...review, round: 2 }, "abandon");
    assert.equal(stream.requests, 0);
    const completion = session.store.getState().send("Explain this SQL");
    const input = await stream.requested;

    assert.deepEqual(input.messages, []);
    assert.equal(input.resume?.[0]?.interruptId, "sql-review");
    const payload = workflowReviewResponseSchema.parse(
      input.resume?.[0]?.payload,
    );

    assert.equal(payload.action, "message");
    assert.equal(
      payload.action === "message" ? payload.message : null,
      "Explain this SQL",
    );
    assert.equal(payload.round, 3);
    assert.equal(
      session.store.getState().messages.at(-1)?.content,
      "Explain this SQL",
    );
    stream.emit({
      type: "RUN_STARTED",
      runId: input.runId,
      threadId: input.threadId,
    });
    stream.finish(input);
    await completion;
  } finally {
    disconnect();
  }
});

test("older task snapshots cannot replace newer progress or completed continuation", () => {
  const stream = streamingAgent("task-recovery");
  const session = createConversationSession(
    { threadId: "task-recovery" },
    stream.agent,
  );
  const saved = snapshot("run", "completed");
  const task = {
    taskId: "task",
    workflowCallId: "call",
    label: "Build artifact",
    revision: 3,
    status: "succeeded" as const,
    stage: "done",
    message: "Ready",
    progress: 100,
    history: [],
    continuationStatus: "completed" as const,
  };
  const disconnect = connectSession(session, () => Promise.resolve(saved));

  try {
    session.receiveSnapshot({ ...saved, externalTasks: [task] });
    session.receiveSnapshot({
      ...saved,
      externalTasks: [
        { ...task, revision: 2, status: "running", message: "Building" },
      ],
    });
    session.receiveSnapshot({
      ...saved,
      externalTasks: [{ ...task, continuationStatus: null }],
    });
    assert.equal(session.store.getState().externalTasks[0]?.message, "Ready");
    assert.equal(
      session.store.getState().externalTasks[0]?.continuationStatus,
      "completed",
    );
  } finally {
    disconnect();
  }
});

test("external waits are identified separately from user review", async () => {
  const { parseExternalWait } = await import("@shared/external-task");
  const { parseWorkflowReview } = await import("@shared/workflow-review");
  const { composerState } = await import("../model/selectors");
  const session = createConversationSession({ threadId: "external" });
  const interrupt = InterruptSchema.parse({
    id: "external-wait",
    reason: "Waiting",
    metadata: {
      langgraph: {
        raw: {
          kind: "workflow_external_wait",
          taskId: "task",
          workflowCallId: "call",
        },
      },
    },
  });

  assert.equal(parseExternalWait(interrupt)?.taskId, "task");
  assert.equal(parseWorkflowReview(interrupt), null);
  session.store.setState({ pendingInterrupts: [interrupt] });
  assert.equal(
    composerState(session.store.getState()).waitingForExternalTask,
    true,
  );
});

test("an experiment review submits while an external task is still waiting", async () => {
  const stream = streamingAgent("mixed-external");
  const session = createConversationSession(
    { threadId: "mixed-external" },
    stream.agent,
  );
  const paused = snapshot("paused", "interrupted");

  paused.interrupts = [
    InterruptSchema.parse({
      id: "plan-review",
      reason: "Review plan",
      metadata: {
        langgraph: {
          raw: {
            kind: "experiment_plan_review",
            workflowCallId: "plan",
            title: "Plan",
            steps: ["Step"],
          },
        },
      },
    }),
    InterruptSchema.parse({
      id: "external-wait",
      reason: "External task",
      metadata: {
        langgraph: {
          raw: {
            kind: "workflow_external_wait",
            workflowCallId: "report",
            taskId: "task",
          },
        },
      },
    }),
  ];
  const disconnect = connectSession(session, () => Promise.resolve(paused));

  try {
    session.receiveSnapshot(paused);
    const submission = session.store.getState().reviewPlan([
      {
        interruptId: "plan-review",
        decision: "approve",
        title: "Plan",
        steps: ["Step"],
      },
    ]);

    await waitFor(() => stream.requests === 1);
    const input = await stream.requested;

    assert.deepEqual(
      input.resume?.map((entry) => entry.interruptId),
      ["plan-review"],
    );
    stream.emit({
      type: "RUN_STARTED",
      threadId: input.threadId,
      runId: input.runId,
    });
    stream.finish(input);
    await submission;
  } finally {
    disconnect();
  }
});
