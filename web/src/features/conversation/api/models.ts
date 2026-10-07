import { selectConversationModelSchema } from "@shared/conversation";
import { z } from "zod";

const selectionSchema = selectConversationModelSchema.extend({
  threadId: z.string().min(1),
});

export async function selectConversationModel(
  threadId: string,
  modelId: string,
  signal: AbortSignal,
) {
  const response = await fetch(
    `/conversations/${encodeURIComponent(threadId)}/model`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId }),
      signal,
    },
  );
  const value: unknown = await response.json();

  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(value);

    throw new Error(
      error.success ? error.data.error : "Model selection is unavailable",
    );
  }

  const selection = selectionSchema.parse(value);

  if (selection.threadId !== threadId || selection.modelId !== modelId) {
    throw new Error("Invalid model selection response");
  }

  return selection;
}
