/** Reads a valid conversation identity from a chat pathname. */
export function conversationIdFromPath(path: string): string | null {
  const match = /^\/c\/([^/]+)\/?$/.exec(path);

  if (!match) {
    return null;
  }

  try {
    const threadId = decodeURIComponent(match[1]!);

    return threadId.length > 0 && threadId.length <= 256 ? threadId : null;
  } catch {
    return null;
  }
}

/** Builds a chat pathname without treating an ID as multiple path segments. */
export function conversationPath(threadId: string): string {
  return `/c/${encodeURIComponent(threadId)}`;
}
