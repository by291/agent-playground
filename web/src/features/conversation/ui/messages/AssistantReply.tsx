import type { ReactNode } from "react";
import { AssistantFrame, AssistantText, ThinkingStatus } from "./MessageRow";
import { hasMessageText } from "../../model/presentation";
import { toolProcess, type ChatTurn } from "../../model/turns";
import { ToolProcess } from "./ToolProcess";
import { isRunActive } from "@shared/run-status";

export function AssistantReply({
  turn,
  animatedMessageId,
  children,
  processDetails,
}: {
  turn: ChatTurn;
  animatedMessageId: string | null;
  children?: ReactNode;
  processDetails?: ReactNode;
}) {
  const process = toolProcess(turn);
  const final = turn.messages.filter(
    (message) =>
      message.role === "assistant" &&
      !message.toolCalls?.length &&
      hasMessageText(message),
  );
  const active = turn.status !== null && isRunActive(turn.status);

  if (!process.length && !final.length && !active && !children) {
    return null;
  }

  const toolsRunning = process.some((entry) =>
    entry.calls.some((step) => step.status === "running"),
  );

  return (
    <AssistantFrame>
      {process.length > 0 && (
        <ToolProcess process={process}>{processDetails}</ToolProcess>
      )}
      {children}
      {final.map((message) => (
        <AssistantText
          key={message.id}
          message={message}
          streaming={active && animatedMessageId === message.id}
        />
      ))}
      {active && !toolsRunning && !final.length && (
        <ThinkingStatus
          label={process.length ? "Preparing reply" : "Thinking"}
        />
      )}
    </AssistantFrame>
  );
}
