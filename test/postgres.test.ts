import { randomUUID } from "node:crypto";
import { HumanMessage } from "@langchain/core/messages";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { createAgent, FakeToolCallingModel } from "langchain";
import { describe, expect, it } from "vitest";
import { createAgentRuntime } from "../src/runtime.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("PostgreSQL checkpoint", () => {
  it("restores previous turns after creating a new agent instance", async () => {
    const threadId = randomUUID();
    const firstSaver = PostgresSaver.fromConnString(databaseUrl!);
    const secondSaver = PostgresSaver.fromConnString(databaseUrl!);

    try {
      await firstSaver.setup();
      const firstAgent = createAgent({
        model: new FakeToolCallingModel(),
        tools: [],
        checkpointer: firstSaver,
      });
      await firstAgent.invoke(
        { messages: [new HumanMessage({ id: randomUUID(), content: "First turn" })] },
        { configurable: { thread_id: threadId } },
      );

      await secondSaver.setup();
      const secondAgent = createAgent({
        model: new FakeToolCallingModel(),
        tools: [],
        checkpointer: secondSaver,
      });
      const result = await secondAgent.invoke(
        { messages: [new HumanMessage({ id: randomUUID(), content: "Second turn" })] },
        { configurable: { thread_id: threadId } },
      );

      const userMessages = result.messages.filter((message) => HumanMessage.isInstance(message));
      expect(userMessages.map((message) => message.content)).toEqual(["First turn", "Second turn"]);
    } finally {
      await Promise.all([firstSaver.end(), secondSaver.end()]);
    }
  });

  it("translates a LangChain tool run into AG-UI events", async () => {
    const model = new FakeToolCallingModel({
      toolCalls: [[{ id: "call-1", name: "get_current_time", args: {} }], []],
    });
    const runtime = await createAgentRuntime({ databaseUrl: databaseUrl!, model });
    const events: string[] = [];

    try {
      await runtime.run(
        { threadId: randomUUID(), runId: randomUUID(), messageId: randomUUID(), message: "What time is it?" },
        (event) => events.push(event.type),
        new AbortController().signal,
      );
      expect(events).toContain("TOOL_CALL_START");
      expect(events).toContain("TOOL_CALL_ARGS");
      expect(events).toContain("TOOL_CALL_END");
      expect(events).toContain("TOOL_CALL_RESULT");
      expect(events).toContain("TEXT_MESSAGE_CONTENT");
    } finally {
      await runtime.close();
    }
  });
});
