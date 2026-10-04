interface ChangeSource {
  addEventListener: (name: string, listener: () => void) => void;
  close: () => void;
}

export function subscribeConversationChanges(
  threadId: string,
  refresh: () => void,
  create: (url: string) => ChangeSource = (url) => new EventSource(url),
) {
  const source = create(
    `/conversations/${encodeURIComponent(threadId)}/events`,
  );

  source.addEventListener("ready", refresh);
  source.addEventListener("changed", refresh);

  return () => source.close();
}
