import { useCallback, useState, type ReactNode } from "react";
import type { ReasoningMessage } from "@ag-ui/client";
import { AssistantFrame, AssistantText, ThinkingStatus } from "./MessageRow";
import { hasMessageText } from "../../model/presentation";
import { toolProcess, type ChatTurn } from "../../model/turns";
import { ToolProcess } from "./ToolProcess";
import { ReasoningProcess } from "./ReasoningProcess";
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
  const [visibleAnswers, setVisibleAnswers] = useState(() => new Set<string>());
  const reportVisibleAnswer = useCallback((messageId: string) => {
    setVisibleAnswers((previous) => {
      if (previous.has(messageId)) {
        return previous;
      }

      return new Set([...previous, messageId]);
    });
  }, []);
  const process = toolProcess(turn);
  const final = turn.messages.filter(
    (message) =>
      message.role === "assistant" &&
      !message.toolCalls?.length &&
      hasMessageText(message),
  );
  const active = turn.status !== null && isRunActive(turn.status);
  const reasoning = turn.messages.filter(
    (message): message is ReasoningMessage =>
      message.role === "reasoning" && hasMessageText(message),
  );
  const latestReasoning = reasoning.at(-1);
  const latestReasoningIndex = latestReasoning
    ? turn.messages.indexOf(latestReasoning)
    : -1;
  const replyAfterReasoning = turn.messages
    .slice(latestReasoningIndex + 1)
    .find(
      (message) => final.includes(message) && visibleAnswers.has(message.id),
    );

  if (
    !reasoning.length &&
    !process.length &&
    !final.length &&
    !active &&
    !children
  ) {
    return null;
  }

  const toolsRunning = process.some((entry) =>
    entry.calls.some((step) => step.status === "running"),
  );

  return (
    <AssistantFrame>
      {reasoning.length > 0 && (
        <ReasoningProcess
          messages={reasoning}
          active={active}
          thinking={active && turn.messages.at(-1)?.role === "reasoning"}
          replyId={replyAfterReasoning?.id ?? null}
        />
      )}
      {process.length > 0 && (
        <ToolProcess process={process}>{processDetails}</ToolProcess>
      )}
      {children}
      {final.map((message) => (
        <AssistantText
          key={message.id}
          message={message}
          streaming={active && animatedMessageId === message.id}
          onTextVisible={reportVisibleAnswer}
        />
      ))}
      {active && !reasoning.length && !toolsRunning && !final.length && (
        <ThinkingStatus
          label={process.length ? "Preparing reply" : "Thinking"}
        />
      )}
    </AssistantFrame>
  );
}
