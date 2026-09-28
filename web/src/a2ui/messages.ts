import {
  A2uiMessageListSchema,
  A2uiMessageListWrapperSchema,
  type A2uiMessage,
} from "@a2ui/web_core/v0_9";

export function parseA2UIMessages(value: unknown): A2uiMessage[] {
  const messages = Array.isArray(value)
    ? A2uiMessageListSchema.parse(value)
    : A2uiMessageListWrapperSchema.parse(value).messages;
  // The published schema and public message type differ on optional fields.
  return messages as A2uiMessage[];
}
