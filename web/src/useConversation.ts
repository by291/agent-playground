import {
  EventType,
  HttpAgent,
  type Interrupt,
  type Message,
  type ResumeEntry,
} from "@ag-ui/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseA2UICard } from "./a2ui";
import { saveConversation, type SavedConversation } from "./conversation";
import { parsePlanReview, type PlanReviewResponse } from "./planReview";

export interface Activity {
  id: string;
  type: string;
  detail?: string;
}

export function useConversation(saved: SavedConversation) {
  const [agent] = useState(() => {
    const client = new HttpAgent({
      url: "/agent",
      threadId: saved.threadId,
      initialMessages: saved.messages,
    });
    client.pendingInterrupts = saved.pendingInterrupts;
    return client;
  });
  const [messages, setMessages] = useState<Message[]>(() => [
    ...agent.messages,
  ]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [cards, setCards] = useState(() => saved.cards);
  const cardsRef = useRef(saved.cards);
  const [pendingInterrupts, setPendingInterrupts] = useState<Interrupt[]>(
    saved.pendingInterrupts,
  );
  const pendingRef = useRef(saved.pendingInterrupts);
  const [running, setRunning] = useState(false);
  const active = useRef(true);

  const persist = useCallback(() => {
    if (active.current) {
      saveConversation({
        threadId: agent.threadId,
        messages: agent.messages,
        cards: cardsRef.current,
        pendingInterrupts: pendingRef.current,
      });
    }
  }, [agent]);

  useEffect(() => {
    active.current = true;
    function rememberCard(card: NonNullable<ReturnType<typeof parseA2UICard>>) {
      const index = cardsRef.current.findIndex((item) => item.id === card.id);
      cardsRef.current =
        index < 0
          ? [...cardsRef.current, card]
          : cardsRef.current.map((item, position) =>
              position === index ? card : item,
            );
      setCards(cardsRef.current);
      persist();
    }

    const subscription = agent.subscribe({
      onEvent({ event }) {
        if (event.type === EventType.TOOL_CALL_RESULT) {
          const card =
            typeof event.toolCallId === "string" &&
            typeof event.content === "string"
              ? parseA2UICard(event.toolCallId, event.content, event.toolCallId)
              : null;
          if (card) rememberCard(card);
        }
        if (
          event.type === EventType.CUSTOM &&
          event.name === "experiment_card"
        ) {
          const value: unknown = event.value;
          if (
            typeof value === "object" &&
            value !== null &&
            "id" in value &&
            typeof value.id === "string"
          ) {
            const toolCallId =
              "toolCallId" in value && typeof value.toolCallId === "string"
                ? value.toolCallId
                : undefined;
            const card = parseA2UICard(
              value.id,
              JSON.stringify(value),
              toolCallId,
            );
            if (card) rememberCard(card);
          }
        }
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
      onRunFinishedEvent({ event }) {
        const next =
          event.outcome?.type === "interrupt" ? event.outcome.interrupts : [];
        pendingRef.current = next;
        setPendingInterrupts(next);
        persist();
      },
    });

    return () => {
      active.current = false;
      agent.abortRun();
      subscription.unsubscribe();
    };
  }, [agent, persist]);

  async function run(resume?: ResumeEntry[]): Promise<void> {
    setRunning(true);

    try {
      await agent.runAgent({
        runId: crypto.randomUUID(),
        ...(resume ? { resume } : {}),
      });
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

  async function send(content: string): Promise<void> {
    const text = content.trim();
    if (!text || running || agent.isRunning || pendingRef.current.length)
      return;

    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: text });
    setMessages([...agent.messages]);
    persist();
    await run();
  }

  async function reviewPlan(responses: PlanReviewResponse[]): Promise<void> {
    if (running || agent.isRunning) return;
    const pending = pendingRef.current;
    if (
      pending.length !== responses.length ||
      pending.some((item, index) => item.id !== responses[index]?.interruptId)
    )
      return;

    await run(
      responses.map(({ interruptId, decision, title, steps }) => ({
        interruptId,
        status: "resolved",
        payload: { decision, title, steps },
      })),
    );
  }

  return {
    messages,
    cards,
    reviews: pendingInterrupts.flatMap((item) => {
      const review = parsePlanReview(item);
      return review ? [review] : [];
    }),
    waitingForReview: pendingInterrupts.length > 0,
    activity,
    running,
    send,
    reviewPlan,
  };
}
