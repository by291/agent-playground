import { queryOptions } from "@tanstack/react-query";
import { agentInfoSchema } from "@shared/agent-info";

export function agentInfoQueryOptions() {
  return queryOptions({
    queryKey: ["agent-info"],
    queryFn: async ({ signal }) => {
      const response = await fetch("/agent-info", { signal });

      if (!response.ok) {
        throw new Error("Agent metadata is unavailable");
      }

      const value: unknown = await response.json();

      return agentInfoSchema.parse(value);
    },
    staleTime: 60_000,
    retry: 1,
  });
}
