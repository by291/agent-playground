import {
  HttpAgent,
  MessageSchema,
  type AgentSubscriber,
  type Message,
} from "@ag-ui/client";

export function configureConversationAgent(agent: HttpAgent) {
  agent.use((input, next) => {
    const state = { ...input.state } as Record<string, unknown>;
    const userMessage = [...input.messages]
      .reverse()
      .find((message) => message.role === "user");
    let messages: Message[] = [];

    if (!input.resume?.length && userMessage) {
      messages = [userMessage];
    }

    // Model history and reporting fields belong to the server's checkpoint.
    delete state.messages;
    delete state.context_usage;
    delete state.response_messages;
    delete state.toolErrors;

    return next.run({ ...input, messages, state });
  });
}

export function subscribeConversationAgent(
  agent: HttpAgent,
  observer: Omit<
    AgentSubscriber,
    "onToolCallStartEvent" | "onStateSnapshotEvent"
  >,
) {
  return agent.subscribe({
    ...observer,
    onToolCallStartEvent({ event, messages, input }) {
      if (!input.resume?.length) {
        return;
      }

      // A resumed LangGraph tool replays its full argument stream. Reset only
      // the saved call before the SDK starts appending the replayed fragments.
      return {
        messages: messages.map((message) => {
          if (
            message.role !== "assistant" ||
            !message.toolCalls?.some((call) => call.id === event.toolCallId)
          ) {
            return message;
          }

          return {
            ...message,
            toolCalls: message.toolCalls.map((call) =>
              call.id === event.toolCallId
                ? { ...call, function: { ...call.function, arguments: "" } }
                : call,
            ),
          };
        }),
      };
    },

    onStateSnapshotEvent({ event, messages }) {
      const snapshot = event.snapshot as Record<string, unknown> | null;

      if (!snapshot || !Array.isArray(snapshot.toolErrors)) {
        return;
      }

      const errors = snapshot.toolErrors.flatMap((value: unknown) => {
        const parsed = MessageSchema.safeParse(value);

        return parsed.success &&
          parsed.data.role === "tool" &&
          parsed.data.error
          ? [parsed.data]
          : [];
      });

      if (!errors.length) {
        return;
      }

      return {
        messages: messages.flatMap<Message>((message) => {
          if (
            message.role === "tool" &&
            errors.some((error) => error.toolCallId === message.toolCallId)
          ) {
            return [];
          }

          if (message.role === "assistant") {
            const ownedErrors = errors.filter((error) =>
              message.toolCalls?.some((call) => call.id === error.toolCallId),
            );

            return [message, ...ownedErrors];
          }

          return [message];
        }),
      };
    },
  });
}
