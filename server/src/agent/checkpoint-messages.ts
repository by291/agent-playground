import { MessageSchema } from "../../../shared/ag-ui-schemas.js";
import { ToolCallSchema } from "@ag-ui/core/schemas";
import { type Message } from "@ag-ui/client";

export const reasoningMessageSuffix = "-reasoning";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function textContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((part: unknown) => {
      const item = record(part);

      return item?.type === "text" && typeof item.text === "string"
        ? [item.text]
        : [];
    })
    .join("\n");
}

function publicMessage(value: unknown): Message | null {
  const raw = record(value);

  // Compaction summaries belong to model context, not the public conversation archive.
  if (!raw || record(raw.additional_kwargs)?.lc_source === "summarization") {
    return null;
  }

  const content = textContent(raw.content);
  let message: unknown;

  if (raw.type === "ai") {
    const toolCalls = Array.isArray(raw.tool_calls)
      ? raw.tool_calls.flatMap((value: unknown) => {
          const call = record(value);
          const parsed = ToolCallSchema.safeParse({
            id: call?.id,
            type: "function",
            function: {
              name: call?.name,
              arguments: JSON.stringify(call?.args ?? {}),
            },
          });

          return parsed.success ? [parsed.data] : [];
        })
      : [];

    if (!content.trim() && !toolCalls.length) {
      return null;
    }

    message = {
      id: raw.id,
      role: "assistant",
      content,
      ...(toolCalls.length ? { toolCalls } : {}),
    };
  } else if (raw.type === "tool") {
    message = {
      id: raw.id,
      role: "tool",
      content,
      toolCallId: raw.tool_call_id,
      ...(raw.status === "error" ? { error: content || "Tool failed" } : {}),
    };
  } else {
    return null;
  }

  const parsed = MessageSchema.safeParse(message);

  return parsed.success ? parsed.data : null;
}

function publicReasoning(value: unknown): Message | null {
  const raw = record(value);
  const extra = record(raw?.additional_kwargs);

  if (
    raw?.type !== "ai" ||
    typeof raw.id !== "string" ||
    extra?.lc_source === "summarization"
  ) {
    return null;
  }

  let content = "";

  if (typeof extra?.reasoning_content === "string") {
    content = extra.reasoning_content;
  } else if (Array.isArray(raw.content)) {
    content = raw.content
      .flatMap((part: unknown) => {
        const item = record(part);

        if (item?.type === "reasoning" && typeof item.reasoning === "string") {
          return [item.reasoning];
        }

        if (item?.type === "thinking" && typeof item.thinking === "string") {
          return [item.thinking];
        }

        return [];
      })
      .join("\n\n");
  }

  if (!content.trim()) {
    return null;
  }

  const parsed = MessageSchema.safeParse({
    id: `${raw.id}${reasoningMessageSuffix}`,
    role: "reasoning",
    content,
  });

  return parsed.success ? parsed.data : null;
}

export function publicToolErrors(values: unknown): Message[] {
  const state = record(values);
  const errors = new Map<string, Message>();

  for (const collection of [state?.messages, state?.response_messages]) {
    if (!Array.isArray(collection)) {
      continue;
    }

    for (const value of collection) {
      const raw = record(value);

      if (raw?.type !== "tool" || raw.status !== "error") {
        continue;
      }

      const message = publicMessage(raw);

      if (message?.role === "tool") {
        errors.set(message.toolCallId, message);
      }
    }
  }

  return [...errors.values()];
}

export function completedMessages(values: unknown): Message[] {
  const state = record(values);

  if (!state) {
    return [];
  }

  const history: unknown[] = Array.isArray(state.messages)
    ? state.messages
    : [];
  // Turn responses survive model-history compaction; older checkpoints fall back to history.
  const responses: unknown[] = Array.isArray(state.response_messages)
    ? state.response_messages
    : history;

  const messages = responses.flatMap((raw) => {
    const reasoning = publicReasoning(raw);
    const message = publicMessage(raw);

    return [...(reasoning ? [reasoning] : []), ...(message ? [message] : [])];
  });

  const savedIds = new Set(messages.map((message) => message.id));

  // Older checkpoints archived only AI messages. Recover their tool results when
  // they are still present in model history, immediately after their caller.
  for (const value of history) {
    const result = publicMessage(value);

    if (result?.role !== "tool" || savedIds.has(result.id)) {
      continue;
    }

    const callerIndex = messages.findIndex(
      (message) =>
        message.role === "assistant" &&
        message.toolCalls?.some((call) => call.id === result.toolCallId),
    );

    if (callerIndex >= 0) {
      let insertionIndex = callerIndex + 1;

      while (messages[insertionIndex]?.role === "tool") {
        insertionIndex += 1;
      }

      messages.splice(insertionIndex, 0, result);
      savedIds.add(result.id);
    }
  }

  return messages;
}
