import { agentInfoSchema } from "../../../shared/agent-info.js";
import { aegraUrl } from "./aegra-client.js";

export async function fetchAgentInfo(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(5000);
  const response = await fetch(new URL("/agent-info", aegraUrl), {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });

  if (!response.ok) {
    throw new Error("Agent metadata is unavailable");
  }

  const value: unknown = await response.json();

  return agentInfoSchema.parse(value);
}
