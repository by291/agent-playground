import assert from "node:assert/strict";
import test from "node:test";
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
import type { ConversationSnapshot } from "./contracts";
import {
  loadConversation,
  newConversation,
  saveConversation,
  type SavedConversation,
} from "./storage";
import type { A2UIOutput } from "../a2ui/outputs";
import { chatTurns, toolProcess } from "../chat/turns";

void test("a resumed tool argument stream replaces saved arguments instead of appending them", async () => {
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

void test("new tool calls accumulate each argument fragment while execution remains running", async () => {
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

void test("a handled tool error is visible before the model finishes its fallback reply", async () => {
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

  assert.equal(state.running, true);
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
  status: import("../../../shared/run-status").RunStatus = "completed",
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

void test("a fresh conversation can submit before its first snapshot and syncs after the run", async () => {
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
    assert.equal(session.store.getState().recovering, false);
    assert.equal(session.store.getState().snapshotEnabled, false);
    const completion = session.store.getState().send("Hello");
    const input = await stream.requested;

    assert.equal(input.messages[0]?.content, "Hello");
    assert.equal(reads, 0);
    assert.equal(session.store.getState().snapshotEnabled, false);
    savedSnapshot = snapshot(input.runId);
    stream.emit({
      type: "RUN_STARTED",
      threadId: input.threadId,
      runId: input.runId,
    });
    stream.finish(input);
    await completion;
    assert.equal(reads, 1);
    assert.equal(session.store.getState().snapshotEnabled, true);
    assert.equal(session.store.getState().snapshotPolling, false);
    assert.equal(session.store.getState().messages[0]?.content, "Saved reply");
  } finally {
    disconnect();
  }
});

void test("restoring an empty conversation still requires a snapshot before sending", async () => {
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
    assert.equal(session.store.getState().recovering, true);
    assert.equal(session.store.getState().snapshotEnabled, true);
    await session.store.getState().send("Wait for recovery");
    assert.equal(stream.requests, 0);
    session.receiveSnapshot(null);
    assert.equal(session.store.getState().recovering, false);
  } finally {
    disconnect();
  }
});

void test("snapshot polling stops for idle and terminal runs and follows unfinished recovery", () => {
  const session = createConversationSession({ threadId: "polling-recovery" });
  const disconnect = connectSession(session, () => Promise.resolve(null));

  try {
    session.receiveSnapshot(null);
    assert.equal(session.store.getState().snapshotPolling, false);

    for (const status of [
      "prepared",
      "dispatching",
      "running",
      "submission_unknown",
    ] as const) {
      session.receiveSnapshot(snapshot("recovered-run", status));
      assert.equal(session.store.getState().snapshotPolling, true, status);
    }

    for (const status of ["completed", "failed", "interrupted"] as const) {
      session.receiveSnapshot(snapshot("recovered-run", status));
      assert.equal(session.store.getState().snapshotPolling, false, status);
    }
  } finally {
    disconnect();
  }
});

void test("a failed initial snapshot enables recovery until a successful fetch", () => {
  const session = createConversationSession({ threadId: "polling-error" });
  const disconnect = connectSession(session, () => Promise.resolve(null));

  try {
    session.receiveSnapshotError(new Error("Gateway unavailable"));
    assert.equal(session.store.getState().snapshotPolling, true);
    session.receiveSnapshot(null);
    assert.equal(session.store.getState().snapshotPolling, false);
    assert.equal(session.store.getState().snapshotIssue, null);
  } finally {
    disconnect();
  }
});

void test("live SSE suppresses polling and a failed final sync resumes recovery", async () => {
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
    const duringSubmission = session.store.getState().snapshotPolling;

    stream.emit({
      type: "RUN_STARTED",
      threadId: input.threadId,
      runId: input.runId,
    });
    session.receiveSnapshot(snapshot(input.runId, "running"));
    const duringStream = session.store.getState().snapshotPolling;

    session.receiveSnapshotError(new Error("Focus refresh unavailable"));
    const afterRefreshError = session.store.getState().snapshotPolling;

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
    assert.equal(session.store.getState().snapshotPolling, true);

    session.receiveSnapshot(snapshot(input.runId));
    assert.equal(session.store.getState().snapshotPolling, false);
    assert.equal(session.store.getState().running, false);
    assert.equal(session.store.getState().messages[0]?.content, "Saved reply");
  } finally {
    disconnect();
  }
});

void test("a stale final snapshot keeps recovery enabled until the current run is saved", async () => {
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
    assert.equal(session.store.getState().snapshotPolling, true);

    session.receiveSnapshot(snapshot(input.runId, "running"));
    assert.equal(session.store.getState().snapshotPolling, true);
    session.receiveSnapshot(snapshot(input.runId));
    assert.equal(session.store.getState().snapshotPolling, false);
  } finally {
    disconnect();
  }
});

void test("a saved A2UI sequence gap keeps recovery enabled until missing output arrives", () => {
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
    assert.equal(session.store.getState().snapshotPolling, true);
    session.receiveSnapshot({ ...snapshot(), outputs: [first, second] });
    assert.equal(session.store.getState().snapshotPolling, false);
    assert.equal(session.store.getState().a2uiIssue, null);
  } finally {
    disconnect();
  }
});

void test("restoring a saved conversation never publishes a completed empty state", async (t) => {
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
    await t.test(name, () => {
      const session = createConversationSession({ threadId: name });
      const disconnect = connectSession(session, () => Promise.resolve(saved));
      const completedStates: { messages: number; surfaces: number }[] = [];
      const unsubscribe = session.store.subscribe((state) => {
        if (!state.recovering) {
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

void test("an empty conversation finishes recovery without inventing history", () => {
  const session = createConversationSession({ threadId: "empty-thread" });
  const disconnect = connectSession(session, () => Promise.resolve(null));

  try {
    session.receiveSnapshot(null);
    assert.equal(session.store.getState().recovering, false);
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

void test("a rejected submission unlocks an existing conversation without discarding its pending input", async () => {
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
    assert.equal(session.store.getState().running, false);
    assert.equal(session.store.getState().snapshotPolling, false);
    assert.match(session.store.getState().recoveryIssue ?? "", /admission/i);
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
    assert.equal(session.store.getState().running, false);
    assert.equal(inputs.length, 1);
    await session.store.getState().send("Another attempt");
    assert.equal(inputs.length, 2);
  } finally {
    disconnect();
  }
});

void test("a stale completed snapshot cannot erase a new stream or leak into another session", async () => {
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
    assert.equal(first.store.getState().running, true);
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
    assert.equal(first.store.getState().running, false);
  } finally {
    disconnect();
    disconnectSecond();
  }
});

void test("reload retries a prepared submission once with the original input", async () => {
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
    await waitFor(() => !session.store.getState().running);
  } finally {
    disconnect();
  }
});

void test("context usage streams and recovers without replaying archived messages", async () => {
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

void test("an unknown server submission is recovered without resending it", () => {
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
    assert.equal(session.store.getState().recovering, false);
    assert.match(session.store.getState().recoveryIssue ?? "", /unknown/i);
  } finally {
    disconnect();
  }
});

void test("repeated outputs share the same surface and conflicts remain visible", () => {
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
    assert.match(session.store.getState().a2uiIssue ?? "", /conflicting/i);
  } finally {
    disconnect();
  }
});

void test("disconnect prevents late recovery from overwriting the new conversation pointer", () => {
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

void test("out-of-order live A2UI updates recover through a snapshot and do not replay on completion", async () => {
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
    assert.equal(session.store.getState().a2uiIssue, null);
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
    assert.equal(session.store.getState().a2uiIssue, null);
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

void test("invalid A2UI events remain visible without interrupting the text stream", async () => {
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
      session.store.getState().a2uiIssue ?? "",
      /Invalid A2UI output/i,
    );
    stream.emit({ type: "TEXT_MESSAGE_END", messageId: "reply" });
    stream.finish(input);
    await completion;
    assert.match(
      session.store.getState().a2uiIssue ?? "",
      /Invalid A2UI output/i,
    );
  } finally {
    disconnect();
  }
});

void test("review submission covers each interrupt once and blocks duplicate sends", async () => {
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
