import { z } from "zod";

const environmentSchema = z.object({
  DEV: z.boolean().default(false),
  VITE_OBSERVABILITY_ENABLED: z.enum(["true", "false"]).default("false"),
});

export function readAppConfig(environment: unknown) {
  const value = environmentSchema.parse(environment ?? {});

  return {
    development: value.DEV,
    observabilityEnabled: value.VITE_OBSERVABILITY_ENABLED === "true",
  };
}

export const appConfig = readAppConfig(import.meta.env);
