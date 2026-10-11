import type { RunAgentInput } from "@ag-ui/client";
import { aegra, aegraUrl } from "./aegra-client.js";
import { ReviewLangGraphAgent } from "./review-agent.js";

export function runAgent(
  input: RunAgentInput,
  onRunCreated: (id: string) => void,
  onProducerSettled: () => Promise<void>,
  modelId: string | null = null,
) {
  // Adapter state belongs to one request; the stateless SDK client can be shared.
  const agent = new ReviewLangGraphAgent(
    {
      graphId: "agent",
      deploymentUrl: aegraUrl,
      client: aegra,
      emitInterruptOutcome: true,
      enableLegacyOnInterruptEvent: false,
    },
    onProducerSettled,
  );

  return agent.run({
    ...input,
    forwardedProps: {
      config: {
        ...(modelId ? { configurable: { model_id: modelId } } : {}),
        metadata: { agui_run_id: input.runId },
      },
      onDisconnect: "continue",
      onRunCreated: ({ run_id }: { run_id: string }) => onRunCreated(run_id),
    },
  });
}

export interface AgentExecution {
  events: ReturnType<typeof runAgent>;
  settle: () => Promise<void>;
}
