import { basicCatalog } from "@a2ui/react/v0_9";
import { EventType, type BaseEvent } from "@ag-ui/client";
import { A2uiMessageListSchema, type A2uiMessage } from "@a2ui/web_core/v0_9";
import { workflowCatalog } from "./catalog";

export interface A2UICard {
  id: string;
  toolCallId?: string;
  messages: A2uiMessage[];
}

export function parseA2UIEvent(event: BaseEvent): A2UICard | null {
  if (
    event.type === EventType.TOOL_CALL_RESULT &&
    typeof event.toolCallId === "string" &&
    typeof event.content === "string"
  ) {
    return parseA2UICard(event.toolCallId, event.content, event.toolCallId);
  }
  if (event.type !== EventType.CUSTOM || event.name !== "experiment_card")
    return null;
  const value: unknown = event.value;
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string"
  )
    return null;
  const toolCallId =
    "toolCallId" in value && typeof value.toolCallId === "string"
      ? value.toolCallId
      : undefined;
  return parseA2UICard(value.id, value, toolCallId);
}

export function parseA2UICard(
  id: string,
  content: unknown,
  toolCallId?: string,
): A2UICard | null {
  try {
    const payload: unknown =
      typeof content === "string" ? JSON.parse(content) : content;
    if (typeof payload !== "object" || payload === null) return null;
    if (!("kind" in payload) || payload.kind !== "a2ui") return null;
    if (!("messages" in payload)) return null;

    const parsed = A2uiMessageListSchema.safeParse(payload.messages);
    if (!parsed.success) return null;
    const creation = parsed.data.find((message) => "createSurface" in message);
    if (
      creation?.createSurface.catalogId !== basicCatalog.id &&
      creation?.createSurface.catalogId !== workflowCatalog.id
    )
      return null;

    // The package's parsed schema and public message type differ on optional fields.
    return {
      id,
      ...(toolCallId === undefined ? {} : { toolCallId }),
      messages: parsed.data as A2uiMessage[],
    };
  } catch {
    return null;
  }
}
