import type { Message, ToolCall } from "@ag-ui/client";
import { isRunActive } from "@shared/run-status";
import {
  userAnswersSchema,
  userQuestionsSchema,
  type UserQuestion,
} from "@shared/agent-interaction";
import { hasMessageText, messageText } from "./presentation";
import type { ChatTurn } from "./turns";

type ToolMessage = Extract<Message, { role: "tool" }>;

export interface ClarificationQuestion {
  id: string;
  questions: UserQuestion[];
  status:
    "preparing" | "waiting" | "answered" | "skipped" | "failed" | "unavailable";
}

export interface ClarificationAnswer {
  question: string;
  answer: string;
}

export type ClarificationReplyPart =
  | {
      type: "assistant";
      id: string;
      turn: ChatTurn;
      clarification?: ClarificationQuestion;
    }
  | {
      type: "answer";
      id: string;
      messageId: string;
      answers: ClarificationAnswer[];
    };

function readQuestions(call: ToolCall): UserQuestion[] {
  try {
    const parsed = userQuestionsSchema.safeParse(
      JSON.parse(call.function.arguments),
    );

    return parsed.success ? parsed.data.questions : [];
  } catch {
    return [];
  }
}

function readAnswers(
  questions: UserQuestion[],
  result: ToolMessage | undefined,
): ClarificationAnswer[] | null {
  if (!questions.length || !result || result.error) {
    return null;
  }

  try {
    const parsed = userAnswersSchema.safeParse(JSON.parse(messageText(result)));

    if (!parsed.success || parsed.data.answers.length !== questions.length) {
      return null;
    }

    const ordered = questions.every(
      (question, index) => question.id === parsed.data.answers[index]?.id,
    );

    if (!ordered) {
      return null;
    }

    return questions.map((question, index) => ({
      question: question.question,
      answer: parsed.data.answers[index]!.answer,
    }));
  } catch {
    return null;
  }
}

function questionStatus(
  callId: string,
  questions: UserQuestion[],
  result: ToolMessage | undefined,
  answers: ClarificationAnswer[] | null,
  status: ChatTurn["status"],
): ClarificationQuestion["status"] {
  if (answers) {
    return "answered";
  }

  if (result?.error) {
    // LangChain records rejection as an error ToolMessage. Never quote its diagnostic
    // string as a human answer; recognize its exact default message or reason form.
    const content = messageText(result);
    const defaultRejection = `User rejected the tool call for \`ask_user\` with id ${callId}. The tool was not executed. Do not retry this tool call unless the user explicitly requests it.`;

    return content === defaultRejection ||
      content.startsWith(
        "User rejected the tool call for `ask_user` with reason: ",
      )
      ? "skipped"
      : "failed";
  }

  if (result) {
    return "unavailable";
  }

  if (status === "failed") {
    return "failed";
  }

  const pending =
    status === "interrupted" || (status !== null && isRunActive(status));

  if (!pending) {
    return "unavailable";
  }

  return questions.length ? "waiting" : "preparing";
}

/** Projects committed tool records into ordered dialogue without altering the archived run. */
export function clarificationReply(
  turn: ChatTurn,
): ClarificationReplyPart[] | null {
  const results = new Map(
    turn.messages.flatMap((message) =>
      message.role === "tool" ? [[message.toolCallId, message] as const] : [],
    ),
  );
  const calls = new Map(
    turn.messages.flatMap((message) =>
      message.role === "assistant"
        ? (message.toolCalls ?? [])
            .filter((call) => call.function.name === "ask_user")
            .map((call) => [call.id, call] as const)
        : [],
    ),
  );
  const callCounts = new Map<string, number>();

  for (const message of turn.messages) {
    if (message.role !== "assistant") {
      continue;
    }

    for (const call of message.toolCalls ?? []) {
      if (call.function.name === "ask_user") {
        callCounts.set(call.id, (callCounts.get(call.id) ?? 0) + 1);
      }
    }
  }

  if (!calls.size) {
    return null;
  }

  const questions = new Map(
    [...calls].map(([id, call]) => [
      id,
      callCounts.get(id) === 1 ? readQuestions(call) : [],
    ]),
  );
  const parts: ClarificationReplyPart[] = [];
  const shownCalls = new Set<string>();
  const shownResults = new Set<string>();
  let messages: Message[] = [];
  let sectionId = `reply:${turn.id}`;

  function flush(clarification?: ClarificationQuestion) {
    const hasAssistantContent = messages.some(
      (message) =>
        (message.role === "assistant" &&
          (hasMessageText(message) || Boolean(message.toolCalls?.length))) ||
        (message.role === "reasoning" && hasMessageText(message)),
    );

    if (!hasAssistantContent && !clarification) {
      messages = [];

      return;
    }

    // Dialogue boundaries retain identity as a resumed block starts streaming or
    // gains another question, preserving its text, disclosures and Sources sheet.
    const id = sectionId;

    parts.push({
      type: "assistant",
      id,
      turn: { ...turn, id, user: null, messages },
      ...(clarification ? { clarification } : {}),
    });
    messages = [];

    if (clarification) {
      sectionId = `after-question:${clarification.id}`;
    }
  }

  for (const message of turn.messages) {
    if (
      message.role === "assistant" &&
      message.toolCalls?.some((call) => calls.has(call.id))
    ) {
      const ordinaryCalls = message.toolCalls.filter(
        (call) => !calls.has(call.id),
      );

      if (hasMessageText(message)) {
        messages.push({ ...message, toolCalls: [] });
      }

      if (ordinaryCalls.length) {
        messages.push({
          ...message,
          id: message.id,
          content: "",
          toolCalls: ordinaryCalls,
        });
      }

      for (const call of message.toolCalls) {
        if (!calls.has(call.id) || shownCalls.has(call.id)) {
          continue;
        }

        shownCalls.add(call.id);
        const requested = questions.get(call.id)!;
        const result = results.get(call.id);
        const answers = readAnswers(requested, result);

        flush({
          id: call.id,
          questions: requested,
          status: questionStatus(
            call.id,
            requested,
            result,
            answers,
            turn.status,
          ),
        });
      }

      continue;
    }

    if (message.role === "tool" && calls.has(message.toolCallId)) {
      if (
        shownResults.has(message.toolCallId) ||
        message !== results.get(message.toolCallId)
      ) {
        continue;
      }

      shownResults.add(message.toolCallId);
      const answers = readAnswers(questions.get(message.toolCallId)!, message);

      if (answers) {
        flush();
        parts.push({
          type: "answer",
          id: `answer:${message.toolCallId}`,
          messageId: message.id,
          answers,
        });
        sectionId = `after-answer:${message.toolCallId}`;
      }

      continue;
    }

    messages.push(message);
  }

  flush();

  return parts;
}
