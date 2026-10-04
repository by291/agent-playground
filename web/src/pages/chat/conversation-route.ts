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

export function conversationPath(threadId: string): string {
  return `/c/${encodeURIComponent(threadId)}`;
}
