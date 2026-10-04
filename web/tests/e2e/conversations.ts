import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";
import type { RunAgentInput } from "@ag-ui/client";
import type { ConversationSnapshot } from "../../src/features/conversation/api/contracts";

export async function createCompletedConversation(
  request: APIRequestContext,
  title: string,
) {
  const threadId = randomUUID();
  const input: RunAgentInput = {
    threadId,
    runId: randomUUID(),
    messages: [{ id: randomUUID(), role: "user", content: title }],
    tools: [],
    context: [],
    state: {},
  };
  const response = await request.post("http://127.0.0.1:4300/agent", {
    data: input,
  });

  expect(response.ok()).toBe(true);
  const stored = await request.get(
    `http://127.0.0.1:4300/__e2e/stored-conversation/${threadId}`,
  );

  expect(stored.ok()).toBe(true);
  const snapshot = (await stored.json()) as ConversationSnapshot;

  expect(snapshot.runs.find((run) => run.runId === input.runId)?.status).toBe(
    "completed",
  );
  expect(
    snapshot.messages.some((message) => message.role === "assistant"),
  ).toBe(true);

  return threadId;
}
