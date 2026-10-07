import type { AgentInfo } from "../../shared/agent-info";
import { SubmissionError } from "../conversation/errors";
import type { RunAgentInput } from "@ag-ui/client";

export function requestedModelId(input: RunAgentInput): string | undefined {
  const props: unknown = input.forwardedProps;

  if (!props || typeof props !== "object" || !("modelId" in props)) {
    return undefined;
  }

  const modelId: unknown = props.modelId;

  if (modelId === undefined) {
    return undefined;
  }

  if (typeof modelId !== "string" || !modelId.trim() || modelId.length > 100) {
    throw new SubmissionError("Invalid conversation model", 400);
  }

  return modelId;
}

export function availableModelId(info: AgentInfo, selected?: string | null) {
  const modelId = selected ?? info.defaultModelId ?? "deepseek";
  const models = info.models ?? [
    { id: "deepseek", label: "DeepSeek", model: info.model, available: true },
  ];
  const model = models.find((option) => option.id === modelId);

  if (!model) {
    throw new SubmissionError("Unknown conversation model", 400);
  }

  if (!model.available) {
    throw new SubmissionError("Conversation model is unavailable", 400);
  }

  return modelId;
}
