import type { Message, ToolCall } from "@ag-ui/client";
import type { RunStatus } from "@shared/run-status";
import type { ConversationSnapshot } from "../api/contracts";

type AssistantMessage = Extract<Message, { role: "assistant" }>;
type ToolMessage = Extract<Message, { role: "tool" }>;

export interface ChatTurn {
  id: string;
  user: Extract<Message, { role: "user" }> | null;
  messages: Message[];
  status: RunStatus | null;
}

export interface ToolStep {
  call: ToolCall;
  result: ToolMessage | undefined;
  status: "running" | "completed" | "failed" | "paused" | "unavailable";
}

export function chatTurns(
  messages: readonly Message[],
  runs: ConversationSnapshot["runs"],
): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let current: ChatTurn | undefined;

  for (const message of messages) {
    if (message.role === "user") {
      current = { id: message.id, user: message, messages: [], status: null };
      turns.push(current);
    } else if (message.role === "assistant" || message.role === "tool") {
      if (!current) {
        current = { id: message.id, user: null, messages: [], status: null };
        turns.push(current);
      }

      current.messages.push(message);
    }
  }

  const byUser = new Map(turns.map((turn) => [turn.id, turn]));
  let owner: ChatTurn | undefined;

  for (const run of runs) {
    // Review resumes have no new user message and belong to the preceding turn.
    owner = (run.messageId ? byUser.get(run.messageId) : undefined) ?? owner;

    if (owner) {
      owner.status = run.status;
    }
  }

  if (!owner && turns.length && runs.length) {
    turns.at(-1)!.status = runs.at(-1)!.status;
  }

  return turns;
}

export function toolProcess(turn: ChatTurn): {
  message: AssistantMessage;
  calls: ToolStep[];
}[] {
  const results = new Map(
    turn.messages.flatMap((message) =>
      message.role === "tool" ? [[message.toolCallId, message] as const] : [],
    ),
  );

  return turn.messages.flatMap((message) => {
    if (message.role !== "assistant" || !message.toolCalls?.length) {
      return [];
    }

    return [
      {
        message,
        calls: message.toolCalls.map((call) => {
          const result = results.get(call.id);
          let status: ToolStep["status"] = "unavailable";

          if (result) {
            status = result.error ? "failed" : "completed";
          } else if (turn.status === "interrupted") {
            status = "paused";
          } else if (turn.status === "failed") {
            status = "failed";
          } else if (
            turn.status === "running" ||
            turn.status === "prepared" ||
            turn.status === "dispatching"
          ) {
            status = "running";
          }

          return { call, result, status };
        }),
      },
    ];
  });
}
