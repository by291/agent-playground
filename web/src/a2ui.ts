import { basicCatalog } from "@a2ui/react/v0_9";
import { A2uiMessageListSchema, type A2uiMessage } from "@a2ui/web_core/v0_9";

export interface A2UICard {
  toolCallId: string;
  messages: A2uiMessage[];
}

export function parseA2UICard(
  toolCallId: string,
  content: string,
): A2UICard | null {
  try {
    const payload: unknown = JSON.parse(content);
    if (typeof payload !== "object" || payload === null) return null;
    if (!("kind" in payload) || payload.kind !== "a2ui") return null;
    if (!("messages" in payload)) return null;

    const parsed = A2uiMessageListSchema.safeParse(payload.messages);
    if (!parsed.success) return null;
    const creation = parsed.data.find((message) => "createSurface" in message);
    if (creation?.createSurface.catalogId !== basicCatalog.id) return null;

    // The package's parsed schema and public message type differ on optional fields.
    return { toolCallId, messages: parsed.data as A2uiMessage[] };
  } catch {
    return null;
  }
}
