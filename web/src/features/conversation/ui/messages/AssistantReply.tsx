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
import { latestAgentPlan, type AgentPlanStep } from "../../model/agent-plan";
import { AgentPlan } from "./AgentPlan";
import {
  clarificationReply,
  type ClarificationQuestion,
} from "../../model/clarification-reply";
import {
  ClarificationAnswerMessage,
  ClarificationQuestionContent,
} from "./ClarificationMessages";

interface AssistantReplyProps {
  turn: ChatTurn;
  animatedMessageId: string | null;
  children?: ReactNode;
  processDetails?: ReactNode;
  externalWaitCallIds?: readonly string[];
  messageTimestamps?: Record<string, string>;
}

export function AssistantReply(props: AssistantReplyProps) {
  const parts = clarificationReply(props.turn);

  if (!parts) {
    return (
      <div className="space-y-8">
        <AssistantReplyContent key={`reply:${props.turn.id}`} {...props} />
      </div>
    );
  }

  const process = toolProcess(props.turn, props.externalWaitCallIds);
  const plan = latestAgentPlan(process);
  const active = props.turn.status !== null && isRunActive(props.turn.status);

  // A committed answer may precede the resumed model's first token. Preserve the
  // live continuation and workflow cards without inventing an archived message.
  if (parts.at(-1)?.type === "answer" && (active || props.children)) {
    parts.push({
      type: "assistant",
      id: `after-${parts.at(-1)!.id}`,
      turn: { ...props.turn, user: null, messages: [] },
    });
  }

  const firstAssistant = parts.findIndex((part) => part.type === "assistant");
  let lastAssistant = -1;
  let processDetailsIndex = -1;

  for (const [index, part] of parts.entries()) {
    if (part.type === "assistant") {
      lastAssistant = index;

      if (toolProcess(part.turn).length > 0) {
        processDetailsIndex = index;
      }
    }
  }

  return (
    <div className="space-y-8">
      {parts.map((part, index) =>
        part.type === "answer" ? (
          <ClarificationAnswerMessage
            key={part.id}
            answers={part.answers}
            timestamp={props.messageTimestamps?.[part.messageId]}
          />
        ) : (
          <AssistantReplyContent
            key={part.id}
            {...props}
            turn={part.turn}
            current={index === parts.length - 1}
            plan={index === firstAssistant ? plan : null}
            clarification={part.clarification}
            sourceProcess={process}
            resultMessages={props.turn.messages}
            showSourceSummary={index === lastAssistant}
            fileProcess={index === lastAssistant ? process : []}
            processDetails={
              index === processDetailsIndex ? props.processDetails : undefined
            }
          >
            {index === lastAssistant ? props.children : undefined}
          </AssistantReplyContent>
        ),
      )}
    </div>
  );
}

function AssistantReplyContent({
  turn,
  animatedMessageId,
  children,
  processDetails,
  externalWaitCallIds = [],
  messageTimestamps = {},
  current = true,
  plan: suppliedPlan,
  clarification,
  sourceProcess,
  fileProcess,
  showSourceSummary = true,
  resultMessages,
}: AssistantReplyProps & {
  current?: boolean;
  plan?: AgentPlanStep[] | null;
  clarification?: ClarificationQuestion | undefined;
  sourceProcess?: ReturnType<typeof toolProcess>;
  fileProcess?: ReturnType<typeof toolProcess>;
  showSourceSummary?: boolean;
  resultMessages?: ChatTurn["messages"];
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

  const process = toolProcess(turn, externalWaitCallIds, resultMessages);
  const plan =
    suppliedPlan === undefined ? latestAgentPlan(process) : suppliedPlan;
  const answers = turn.messages.filter(
    (message) =>
      message.role === "assistant" &&
      !message.toolCalls?.length &&
      hasMessageText(message),
  );
  const active = current && turn.status !== null && isRunActive(turn.status);
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
    Boolean(children) ||
    Boolean(clarification) ||
    Boolean(plan?.length);

  if (!hasReplyContent && !active) {
    return null;
  }

  const toolsRunning = process.some((entry) =>
    entry.calls.some((step) => step.status === "running"),
  );
  const showThinkingStatus =
    active &&
    !reasoning.length &&
    !toolsRunning &&
    !answers.length &&
    !clarification;

  return (
    <AssistantFrame>
      {plan && plan.length > 0 && (
        <AgentPlan todos={plan} status={turn.status} />
      )}
      {reasoning.length > 0 && (
        <ReasoningProcess
          messages={reasoning}
          active={active}
          thinking={active && turn.messages.at(-1)?.role === "reasoning"}
          replyId={replyAfterReasoning?.id ?? clarification?.id ?? null}
        />
      )}
      {process.length > 0 && (
        <ExecutionProcess process={process}>{processDetails}</ExecutionProcess>
      )}
      <SkillFiles process={fileProcess ?? process} />
      {children}
      <KnowledgeSources
        process={sourceProcess ?? process}
        showSummary={showSourceSummary}
      >
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
      {clarification && (
        <ClarificationQuestionContent clarification={clarification} />
      )}
      {showThinkingStatus && (
        <ThinkingStatus
          label={process.length ? "Preparing reply" : "Thinking"}
        />
      )}
    </AssistantFrame>
  );
}
