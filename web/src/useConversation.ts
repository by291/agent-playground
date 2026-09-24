import { EventType, HttpAgent, type Message } from "@ag-ui/client";
import { useEffect, useRef, useState } from "react";
import { saveConversation, type SavedConversation } from "./conversation";

export type Activity = { id: string; type: string; detail?: string };

export function useConversation(saved: SavedConversation) {
  const [agent] = useState(
    () =>
      new HttpAgent({
        url: "/agent",
        threadId: saved.threadId,
        initialMessages: saved.messages,
      }),
  );
  const [messages, setMessages] = useState<Message[]>(() => [
    ...agent.messages,
  ]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [running, setRunning] = useState(false);
  const active = useRef(true);

  function persist() {
    if (active.current) {
      saveConversation({ threadId: agent.threadId, messages: agent.messages });
    }
  }

  useEffect(() => {
    active.current = true;
    const subscription = agent.subscribe({
      onEvent({ event }) {
        if (
          event.type === EventType.RAW ||
          event.type === EventType.STATE_SNAPSHOT
        )
          return;
        const detail = "name" in event ? String(event.name) : undefined;
        setActivity((items) =>
          [
            {
              id: crypto.randomUUID(),
              type: event.type,
              ...(detail === undefined ? {} : { detail }),
            },
            ...items,
          ].slice(0, 30),
        );
      },
      onMessagesChanged() {
        setMessages([...agent.messages]);
        persist();
      },
    });

    return () => {
      active.current = false;
      agent.abortRun();
      subscription.unsubscribe();
    };
  }, [agent]);

  async function send(content: string): Promise<void> {
    const text = content.trim();
    if (!text || running || agent.isRunning) return;

    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: text });
    setMessages([...agent.messages]);
    persist();
    setRunning(true);

    try {
      await agent.runAgent({ runId: crypto.randomUUID() });
    } catch (error) {
      console.error("Agent run failed", error);
      const detail = error instanceof Error ? error.message : "Unknown error";
      setActivity((items) =>
        [
          { id: crypto.randomUUID(), type: "RUN_ERROR", detail },
          ...items,
        ].slice(0, 30),
      );
    } finally {
      if (active.current) {
        setRunning(false);
        setMessages([...agent.messages]);
        persist();
      }
    }
  }

  return { messages, activity, running, send };
}
