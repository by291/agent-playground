interface ExternalTaskControlOptions {
  taskId: string;
  action: "input" | "cancel";
  input: string;
  signal: AbortSignal;
}

export const externalTaskControlError = "Agent control failed. Please retry.";

/** Sends a control request to the task owner and reports any HTTP error. */
export async function controlExternalTask({
  taskId,
  action,
  input,
  signal,
}: ExternalTaskControlOptions): Promise<void> {
  const response = await fetch(
    `/external-tasks/${encodeURIComponent(taskId)}/${action}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(action === "input" ? { body: JSON.stringify({ input }) } : {}),
      signal,
    },
  );

  if (response.ok) {
    return;
  }

  const body: unknown = await response.json().catch(() => null);
  const message =
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
      ? body.error
      : externalTaskControlError;

  throw new Error(message);
}
