import { randomUUID } from "node:crypto";
import { EventType, type BaseEvent } from "@ag-ui/core";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { createAgent, tool } from "langchain";
import { z } from "zod";
import type { AgentInput } from "./input.js";

export interface AgentRuntime {
  run(input: AgentInput, emit: (event: BaseEvent) => void, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}

export async function createAgentRuntime(config: {
  databaseUrl: string;
  model: BaseChatModel;
}): Promise<AgentRuntime> {
  const checkpointer = PostgresSaver.fromConnString(config.databaseUrl);
  try {
    await checkpointer.setup();
  } catch (error) {
    await checkpointer.end();
    throw error;
  }

  const getCurrentTime = tool(
    async () => new Date().toISOString(),
    {
      name: "get_current_time",
      description: "Return the current date and time in UTC as an ISO 8601 string.",
      schema: z.object({}),
    },
  );

  const agent = createAgent({
    model: config.model,
    tools: [getCurrentTime],
    checkpointer,
    systemPrompt: "You are a concise assistant. Use get_current_time when the user asks for the current date or time.",
  });

  return {
    async run(input, emit, signal) {
      const stream = await agent.streamEvents(
        { messages: [new HumanMessage({ id: input.messageId, content: input.message })] },
        { version: "v3", configurable: { thread_id: input.threadId }, signal },
      );

      const messages = (async () => {
        for await (const message of stream.messages) {
          const messageId = randomUUID();
          let started = false;
          for await (const delta of message.text) {
            if (!delta) continue;
            if (!started) {
              emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
              started = true;
            }
            emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta });
          }
          if (started) emit({ type: EventType.TEXT_MESSAGE_END, messageId });
        }
      })();

      const toolCalls = (async () => {
        for await (const call of stream.toolCalls) {
          const toolCallId = call.callId;
          emit({ type: EventType.TOOL_CALL_START, toolCallId, toolCallName: call.name });
          emit({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify(call.input ?? {}) });
          emit({ type: EventType.TOOL_CALL_END, toolCallId });
          const result = await call.output;
          const content = extractToolContent(result);
          emit({ type: EventType.TOOL_CALL_RESULT, toolCallId, messageId: randomUUID(), content });
        }
      })();

      await Promise.all([messages, toolCalls, stream.output]);
    },
    close: () => checkpointer.end(),
  };
}

function extractToolContent(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "content" in result) {
    const content = result.content;
    return typeof content === "string" ? content : JSON.stringify(content) ?? "null";
  }
  return JSON.stringify(result) ?? "null";
}
