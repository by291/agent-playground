import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  HttpAgent,
  InterruptSchema,
  RunAgentInputSchema,
  type RunAgentInput,
} from "@ag-ui/client";
import { createConversationSession } from "./session";
import type { ConversationSnapshot } from "./snapshot";
import type { SavedConversation } from "./storage";

const savedValues = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => savedValues.get(key) ?? null,
    setItem: (key: string, value: string) => savedValues.set(key, value),
  },
  configurable: true,
});

function snapshot(
  runId = "old-run",
  status = "completed",
): ConversationSnapshot {
  return {
    messages: [
      { id: "saved-message", role: "assistant", content: "Saved reply" },
    ],
    cards: [],
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
  while (!predicate() && Date.now() < deadline) await delay(1);
  assert.ok(predicate(), "Expected conversation state was not reached");
}

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
  const disconnect = session.connect(() => Promise.resolve(previous));
  try {
    session.applySnapshot(previous);
    await session.store.getState().send("Keep this pending input");

    assert.equal(agent.isRunning, false);
    assert.equal(session.store.getState().running, false);
    assert.match(session.store.getState().recoveryIssue ?? "", /admission/i);
    assert.equal(
      session.store.getState().messages.at(-1)?.content,
      "Keep this pending input",
    );
    const saved = JSON.parse(
      localStorage.getItem("agent-playground-conversation") ?? "null",
    ) as SavedConversation;
    assert.equal(saved.pending?.runId, inputs[0]?.runId);
    assert.deepEqual(saved.pending?.messages, inputs[0]?.messages);

    session.applySnapshot(previous);
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
  const disconnect = first.connect(() => Promise.resolve(finalSnapshot));
  const disconnectSecond = second.connect(() => Promise.resolve(null));
  try {
    first.applySnapshot(snapshot());
    second.applySnapshot(null);
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

    first.applySnapshot(snapshot());
    assert.equal(first.store.getState().messages.at(-1)?.content, "Live reply");
    assert.equal(first.store.getState().running, true);
    assert.deepEqual(second.store.getState().messages, []);
    assert.deepEqual(second.store.getState().activity, []);

    finalSnapshot = snapshot(input.runId);
    finalSnapshot.messages = [
      { id: "checkpoint-message", role: "assistant", content: "Final reply" },
    ];
    first.applySnapshot(finalSnapshot);
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
  const disconnect = session.connect(() =>
    Promise.resolve(snapshot("original-run")),
  );
  try {
    session.applySnapshot(snapshot("original-run", "prepared"));
    session.applySnapshot(snapshot("original-run", "prepared"));
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
  const disconnect = session.connect(() => Promise.resolve(null));
  try {
    session.applySnapshot(snapshot("unknown-run", "submission_unknown"));
    assert.equal(stream.requests, 0);
    assert.equal(session.store.getState().recovering, false);
    assert.match(session.store.getState().recoveryIssue ?? "", /unknown/i);
  } finally {
    disconnect();
  }
});

void test("repeated cards are deduplicated and conflicting content keeps the first card", () => {
  const session = createConversationSession({ threadId: "card-thread" });
  const disconnect = session.connect(() => Promise.resolve(null));
  try {
    const initial = snapshot();
    initial.cards = [{ id: "card", messages: [] }];
    session.applySnapshot(initial);
    session.applySnapshot(initial);
    assert.equal(session.store.getState().cards.length, 1);
    session.applySnapshot({
      ...initial,
      cards: [
        {
          id: "card",
          messages: [
            {
              version: "v0.9",
              createSurface: {
                surfaceId: "changed",
                catalogId: "urn:agent-playground:workflow:v1",
              },
            },
          ],
        },
      ],
    });
    assert.deepEqual(session.store.getState().cards, [
      { id: "card", messages: [] },
    ]);
    assert.match(session.store.getState().recoveryIssue ?? "", /conflicting/i);
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
  const disconnect = session.connect(() => Promise.resolve(null));
  disconnect();
  localStorage.setItem(
    "agent-playground-conversation",
    JSON.stringify({ threadId: "new-thread" }),
  );
  session.applySnapshot(snapshot("old-run"));
  assert.equal(stream.requests, 0);
  assert.deepEqual(
    JSON.parse(localStorage.getItem("agent-playground-conversation") ?? "null"),
    { threadId: "new-thread" },
  );
});

void test("review submission covers each interrupt once and blocks duplicate sends", async () => {
  const stream = streamingAgent("review-thread");
  const session = createConversationSession(
    { threadId: "review-thread" },
    stream.agent,
  );
  let finalSnapshot = snapshot();
  const disconnect = session.connect(() => Promise.resolve(finalSnapshot));
  try {
    const reviewSnapshot = snapshot("paused-run", "interrupted");
    reviewSnapshot.interrupts = [
      InterruptSchema.parse({ id: "review-a", reason: "Review draft A" }),
      InterruptSchema.parse({ id: "review-b", reason: "Review draft B" }),
    ];
    session.applySnapshot(reviewSnapshot);
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
