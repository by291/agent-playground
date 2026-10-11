import { skillFileSchema } from "@shared/skill-files";

/** Uploads under a caller-owned ID so retries keep the same conversation-file identity. */
export async function uploadFile(
  threadId: string,
  id: string,
  file: File,
  signal: AbortSignal,
) {
  const response = await fetch(
    `/conversations/${encodeURIComponent(threadId)}/files`,
    {
      method: "POST",
      headers: { "X-File-Id": id, "X-Filename": encodeURIComponent(file.name) },
      body: file,
      signal,
    },
  );

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const error =
      body && typeof body === "object" && "error" in body
        ? body.error
        : undefined;

    throw new Error(
      typeof error === "string" ? error : "File upload failed. Please retry.",
    );
  }

  const result = skillFileSchema.parse(await response.json());

  // Validate ownership as well as shape before the composer inserts an attachment reference.
  if (
    result.id !== id ||
    result.threadId !== threadId ||
    result.name !== file.name
  ) {
    throw new Error("File upload returned an unexpected identity");
  }

  return result;
}
