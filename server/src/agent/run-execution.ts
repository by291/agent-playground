import type { RunAgentInput } from "@ag-ui/client";
import { aegra, aegraUrl } from "./aegra-client.js";
import { ReviewLangGraphAgent } from "./review-agent.js";

interface RunAgentOptions {
  input: RunAgentInput;
  onRunCreated: (id: string) => void;
  onProducerSettled: () => Promise<void>;
  modelId?: string | null;
}

/** Starts an Aegra run using server-owned settings and lifecycle callbacks. */
export function runAgent({
  input,
  onRunCreated,
  onProducerSettled,
  modelId = null,
}: RunAgentOptions) {
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

/** Pairs public events with completion of the server's run bookkeeping. */
export interface AgentExecution {
  events: ReturnType<typeof runAgent>;
  settle: () => Promise<void>;
}
