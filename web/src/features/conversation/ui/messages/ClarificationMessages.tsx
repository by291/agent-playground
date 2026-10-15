import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent } from "@/components/ui/message";
import type {
  ClarificationAnswer,
  ClarificationQuestion,
} from "../../model/clarification-reply";
import { MessageTimestamp } from "./MessageMetadata";

const questionStatusText: Record<ClarificationQuestion["status"], string> = {
  preparing: "Preparing a question…",
  waiting: "Waiting for your answer",
  answered: "",
  skipped: "Question skipped",
  failed: "The question could not be completed",
  unavailable: "The answer is unavailable",
};

export function ClarificationQuestionContent({
  clarification,
}: {
  clarification: ClarificationQuestion;
}) {
  return (
    <div aria-label="Agent question" className="space-y-3">
      {clarification.questions.map((question) => (
        <p
          key={question.id}
          className="text-base/7 font-medium whitespace-pre-wrap text-ink"
        >
          {question.question}
        </p>
      ))}
      {questionStatusText[clarification.status] && (
        <p className="text-sm text-muted">
          {questionStatusText[clarification.status]}
        </p>
      )}
    </div>
  );
}

/** The human's confirmed answers are a transcript view, not additional run input. */
export function ClarificationAnswerMessage({
  answers,
  timestamp,
}: {
  answers: ClarificationAnswer[];
  timestamp?: string | undefined;
}) {
  return (
    <Message align="end" aria-label="Your clarification response">
      <MessageContent>
        <Bubble
          variant="secondary"
          align="end"
          className="max-w-[85%] sm:max-w-[75%]"
        >
          <BubbleContent className="space-y-4 rounded-lg border-line px-4 py-3 text-[15px]/7 whitespace-pre-wrap">
            {answers.map(({ question, answer }, index) => (
              <div key={index} className="space-y-1">
                <p className="text-sm/6 text-muted">{question}</p>
                <p className="font-medium text-ink">{answer}</p>
              </div>
            ))}
          </BubbleContent>
        </Bubble>
        <MessageTimestamp timestamp={timestamp} className="self-end" />
      </MessageContent>
    </Message>
  );
}
