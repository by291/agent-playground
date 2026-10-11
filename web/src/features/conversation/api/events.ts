interface ChangeSource {
  addEventListener: (name: string, listener: () => void) => void;
  close: () => void;
}

/** Opens a change stream; its caller owns both refresh scheduling and cleanup. */
export function subscribeConversationChanges(
  threadId: string,
  refresh: () => void,
  create: (url: string) => ChangeSource = (url) => new EventSource(url),
) {
  const source = create(
    `/conversations/${encodeURIComponent(threadId)}/events`,
  );

  // A refresh after subscription closes the gap between the initial read and LISTEN.
  source.addEventListener("ready", refresh);
  source.addEventListener("changed", refresh);

  return () => source.close();
}
