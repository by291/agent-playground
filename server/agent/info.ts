import { agentInfoSchema } from "../../shared/agent-info";
import { aegraUrl } from "./client";

export async function fetchAgentInfo() {
  const response = await fetch(new URL("/agent-info", aegraUrl), {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error("Agent metadata is unavailable");
  }

  const value: unknown = await response.json();

  return agentInfoSchema.parse(value);
}
