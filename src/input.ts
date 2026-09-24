import { RunAgentInputSchema } from "@ag-ui/core/schemas";

export type AgentInput = {
  threadId: string;
  runId: string;
  messageId: string;
  message: string;
};

export function parseAgentInput(body: unknown): AgentInput {
  const parsed = RunAgentInputSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Invalid AG-UI run input.");
  }

  const input = parsed.data;
  const latest = input.messages.at(-1);
  if (!input.threadId.trim() || !input.runId.trim()) {
    throw new Error("threadId and runId must be non-empty.");
  }
  if (!latest || latest.role !== "user" || typeof latest.content !== "string" || !latest.content.trim()) {
    throw new Error("The last message must be a non-empty text user message.");
  }
  if (input.tools.length || input.context.length || input.resume?.length) {
    throw new Error("Client tools, context, and resume are not supported yet.");
  }

  // The checkpoint already holds earlier turns. Replaying the client's full history duplicates them.
  return {
    threadId: input.threadId,
    runId: input.runId,
    messageId: latest.id,
    message: latest.content,
  };
}
