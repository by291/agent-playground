import type { Message } from "@ag-ui/client";

export function messageText(message: Message): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  if (!Array.isArray(message.content)) {
    return "";
  }

  const parts: unknown[] = message.content;

  return parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

export function hasMessageText(message: Message): boolean {
  return messageText(message).trim().length > 0;
}

export function waitingForAssistantText(
  messages: readonly Message[],
  running: boolean,
): boolean {
  const latest = [...messages]
    .reverse()
    .find((message) => message.role === "user" || message.role === "assistant");

  if (!running || !latest) {
    return false;
  }

  // Tool-only messages and empty text starts do not replace the waiting status.
  return latest.role === "user" || !hasMessageText(latest);
}
