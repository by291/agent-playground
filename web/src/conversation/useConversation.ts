import {
  EventType,
  HttpAgent,
  type Interrupt,
  type Message,
  type ResumeEntry,
} from "@ag-ui/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseA2UICard, type A2UICard } from "../a2ui/card";
import { parsePlanReview, type PlanReviewResponse } from "./planReview";
import {
  fetchConversationSnapshot,
  mergeMessages,
  type ConversationSnapshot,
} from "./snapshot";
import {
  saveConversation,
  type PendingSubmission,
  type SavedConversation,
} from "./storage";
import type { Activity } from "./types";

export function useConversation(saved: SavedConversation) {
  const [agent] = useState(
    () => new HttpAgent({ url: "/agent", threadId: saved.threadId }),
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [cards, setCards] = useState<A2UICard[]>([]);
  const cardsRef = useRef<A2UICard[]>([]);
  const [pendingInterrupts, setPendingInterrupts] = useState<Interrupt[]>([]);
  const pendingRef = useRef<PendingSubmission | undefined>(saved.pending);
  const [running, setRunning] = useState(false);
  const [animatedMessageId, setAnimatedMessageId] = useState<string | null>(
    null,
  );
  const [recoveryIssue, setRecoveryIssue] = useState<string | null>(null);
  const active = useRef(true);

  const rememberCard = useCallback((card: A2UICard) => {
    const existing = cardsRef.current.find((item) => item.id === card.id);
    if (existing) {
      if (JSON.stringify(existing.messages) !== JSON.stringify(card.messages)) {
        setRecoveryIssue("Conflicting saved card content");
      }
      return;
    }
    cardsRef.current = [...cardsRef.current, card];
    if (active.current) setCards(cardsRef.current);
  }, []);

  const refresh =
    useCallback(async (): Promise<ConversationSnapshot | null> => {
      const snapshot = await fetchConversationSnapshot(saved.threadId);
      if (!snapshot) return null;

      const latest = snapshot.runs.at(-1);
      const finished =
        latest?.status === "completed" ||
        latest?.status === "failed" ||
        latest?.status === "interrupted";
      // Stream message IDs may differ from checkpoint IDs. Once execution ends,
      // the persisted snapshot replaces the preview instead of duplicating it.
      agent.setMessages(
        finished
          ? snapshot.messages
          : mergeMessages(agent.messages, snapshot.messages),
      );
      for (const card of snapshot.cards) rememberCard(card);

      if (active.current) {
        setMessages([...agent.messages]);
        setPendingInterrupts(snapshot.interrupts);
        setRunning(
          latest?.status === "prepared" ||
            latest?.status === "dispatching" ||
            latest?.status === "running" ||
            agent.isRunning,
        );
        setRecoveryIssue(
          latest?.status === "submission_unknown"
            ? "Submission status is unknown. Review the server state before retrying."
            : latest?.status === "failed"
              ? "The agent run failed. Saved cards remain available."
              : null,
        );
      }
      return snapshot;
    }, [agent, rememberCard, saved.threadId]);

  const runSubmission = useCallback(
    async (submission: PendingSubmission) => {
      // Retry the exact submitted input after a reload while it is still prepared.
      agent.setMessages(submission.messages);
      agent.setState(submission.state);
      if (active.current) {
        setMessages([...agent.messages]);
        setRunning(true);
      }
      try {
        await agent.runAgent({
          runId: submission.runId,
          ...(submission.resume ? { resume: submission.resume } : {}),
        });
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : "Agent run failed";
        if (active.current) setRecoveryIssue(detail);
      } finally {
        if (active.current) {
          await refresh().catch((error: unknown) => {
            setRecoveryIssue(
              error instanceof Error ? error.message : "Recovery failed",
            );
          });
        }
      }
    },
    [agent, refresh],
  );

  useEffect(() => {
    active.current = true;
    const subscription = agent.subscribe({
      onEvent({ event }) {
        if (
          event.type === EventType.TEXT_MESSAGE_CONTENT &&
          typeof event.messageId === "string"
        ) {
          setAnimatedMessageId(event.messageId);
        }
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
            const card = parseA2UICard(value.id, value, toolCallId);
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
              ...(detail ? { detail } : {}),
            },
            ...items,
          ].slice(0, 30),
        );
      },
      onMessagesChanged() {
        setMessages([...agent.messages]);
      },
      onRunFinishedEvent({ event }) {
        const next =
          event.outcome?.type === "interrupt" ? event.outcome.interrupts : [];
        setPendingInterrupts(next);
        void refresh();
      },
    });

    void refresh()
      .then((snapshot) => {
        const pending = pendingRef.current;
        if (!pending) return;
        const savedRun = snapshot?.runs.find(
          (run) => run.runId === pending.runId,
        );
        if (!savedRun || savedRun.status === "prepared") {
          void runSubmission(pending);
        } else {
          pendingRef.current = undefined;
          saveConversation({ threadId: saved.threadId });
        }
      })
      .catch((error: unknown) => {
        if (active.current) {
          setRecoveryIssue(
            error instanceof Error ? error.message : "Recovery failed",
          );
        }
      });

    const timer = setInterval(() => {
      void refresh().catch((error: unknown) => {
        if (active.current) {
          setRecoveryIssue(
            error instanceof Error ? error.message : "Recovery failed",
          );
        }
      });
    }, 2000);

    return () => {
      active.current = false;
      clearInterval(timer);
      subscription.unsubscribe();
    };
  }, [agent, refresh, rememberCard, runSubmission, saved.threadId]);

  function submit(submission: PendingSubmission) {
    pendingRef.current = submission;
    saveConversation({ threadId: saved.threadId, pending: submission });
    void runSubmission(submission);
  }

  function send(content: string): Promise<void> {
    const text = content.trim();
    if (!text || running || agent.isRunning || pendingInterrupts.length)
      return Promise.resolve();

    const message: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    submit({
      runId: crypto.randomUUID(),
      messageId: message.id,
      messages: [...agent.messages, message],
      state: structuredClone<Record<string, unknown>>(
        agent.state as Record<string, unknown>,
      ),
      userMessage: message,
    });
    return Promise.resolve();
  }

  function reviewPlan(responses: PlanReviewResponse[]): Promise<void> {
    if (running || agent.isRunning) return Promise.resolve();
    const expected = new Set(pendingInterrupts.map((item) => item.id));
    if (
      expected.size !== responses.length ||
      responses.some((item) => !expected.has(item.interruptId))
    )
      return Promise.resolve();

    const resume: ResumeEntry[] = responses.map(
      ({ interruptId, decision, title, steps }) => ({
        interruptId,
        status: "resolved",
        payload: { decision, title, steps },
      }),
    );
    const runId = crypto.randomUUID();
    submit({
      runId,
      messageId: runId,
      messages: [...agent.messages],
      state: structuredClone<Record<string, unknown>>(
        agent.state as Record<string, unknown>,
      ),
      resume,
    });
    return Promise.resolve();
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
    animatedMessageId,
    recoveryIssue,
    send,
    reviewPlan,
  };
}
