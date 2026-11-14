import type { Message } from "@ag-ui/client";
import { uploadedMessageContent } from "../../../../shared/uploaded-files.js";

function shortenedTitle(text: string) {
  const title = text.replace(/\s+/g, " ").trim();

  return Array.from(title).slice(0, 100).join("") || "Untitled conversation";
}

/** Derive the initial title from the user message. */
export function defaultConversationTitle(message: Message) {
  if (typeof message.content !== "string") {
    return "Untitled conversation";
  }

  return shortenedTitle(uploadedMessageContent(message.content).text);
}

/** Resolve a stored title or derive the legacy presentation from the first message. */
export function presentConversationTitle(
  title: string,
  firstMessage: Message | null | undefined,
) {
  if (!firstMessage || typeof firstMessage.content !== "string") {
    return title;
  }

  // Older admissions derived a title from the entire attachment envelope.
  // Only replace that exact generated value; retain custom saved titles.
  if (title !== shortenedTitle(firstMessage.content)) {
    return title;
  }

  return defaultConversationTitle(firstMessage);
}
