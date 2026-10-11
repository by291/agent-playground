import { useCallback, useState, type ReactNode } from "react";
import type { ReasoningMessage } from "@ag-ui/client";
import { AssistantFrame, AssistantText, ThinkingStatus } from "./MessageRow";
import { hasMessageText } from "../../model/presentation";
import { toolProcess, type ChatTurn } from "../../model/turns";
import { KnowledgeSources } from "./KnowledgeSources";
import { SkillFiles } from "./SkillFiles";
import { ExecutionProcess } from "./SkillProcess";
import { ReasoningProcess } from "./ReasoningProcess";
import { isRunActive } from "@shared/run-status";

export function AssistantReply({
  turn,
  animatedMessageId,
  children,
  processDetails,
  externalWaitCallIds = [],
  messageTimestamps = {},
}: {
  turn: ChatTurn;
  animatedMessageId: string | null;
  children?: ReactNode;
  processDetails?: ReactNode;
  externalWaitCallIds?: readonly string[];
  messageTimestamps?: Record<string, string>;
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

  const process = toolProcess(turn, externalWaitCallIds);
  const answers = turn.messages.filter(
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

  // Reasoning folds only when a later answer has rendered visible text. Receiving
  // an answer message alone is insufficient while its paced presentation is empty.
  const replyAfterReasoning = turn.messages
    .slice(latestReasoningIndex + 1)
    .find(
      (message) => answers.includes(message) && visibleAnswers.has(message.id),
    );
  const hasReplyContent =
    reasoning.length > 0 ||
    process.length > 0 ||
    answers.length > 0 ||
    Boolean(children);

  if (!hasReplyContent && !active) {
    return null;
  }

  const toolsRunning = process.some((entry) =>
    entry.calls.some((step) => step.status === "running"),
  );
  const showThinkingStatus =
    active && !reasoning.length && !toolsRunning && !answers.length;

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
        <ExecutionProcess process={process}>{processDetails}</ExecutionProcess>
      )}
      <SkillFiles process={process} />
      {children}
      <KnowledgeSources process={process}>
        {answers.map((message) => (
          <AssistantText
            key={message.id}
            message={message}
            streaming={active && animatedMessageId === message.id}
            onTextVisible={reportVisibleAnswer}
            settled={!active}
            timestamp={messageTimestamps[message.id]}
          />
        ))}
      </KnowledgeSources>
      {showThinkingStatus && (
        <ThinkingStatus
          label={process.length ? "Preparing reply" : "Thinking"}
        />
      )}
    </AssistantFrame>
  );
}
