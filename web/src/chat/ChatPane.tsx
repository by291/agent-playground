import { Fragment, lazy, Suspense, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import type { A2UICard as CardData } from "../a2ui/card";
import { MessageRow, preloadMarkdownMessage, Thinking } from "./MessageRow";
import { ReviewPanel } from "./ReviewPanel";
import { useConversation } from "../conversation/useConversation";
import { parsePlanReview } from "../conversation/planReview";
import { Welcome } from "./Welcome";

const A2UICard = lazy(() =>
  import("../a2ui/A2UICard").then(({ A2UICard }) => ({ default: A2UICard })),
);

function Card({ card }: { card: CardData }) {
  return (
    <Suspense fallback={null}>
      <A2UICard card={card} />
    </Suspense>
  );
}

export function ChatPane() {
  const {
    messages,
    cards,
    pendingInterrupts,
    running,
    animatedMessageId,
    recoveryIssue,
    onSend,
    onReview,
  } = useConversation(
    useShallow((state) => ({
      messages: state.messages,
      cards: state.cards,
      pendingInterrupts: state.pendingInterrupts,
      running: state.running,
      animatedMessageId: state.animatedMessageId,
      recoveryIssue: state.snapshotIssue ?? state.recoveryIssue,
      onSend: state.send,
      onReview: state.reviewPlan,
    })),
  );
  const reviews = useMemo(
    () =>
      pendingInterrupts.flatMap((item) => {
        const review = parsePlanReview(item);
        return review ? [review] : [];
      }),
    [pendingInterrupts],
  );
  useEffect(() => {
    // Start loading the renderer while the agent prepares its first text event.
    if (running) preloadMarkdownMessage();
  }, [running]);

  const visible = messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );
  const cardsByCall = new Map<string, CardData[]>();
  for (const card of cards) {
    if (!card.toolCallId) continue;
    cardsByCall.set(card.toolCallId, [
      ...(cardsByCall.get(card.toolCallId) ?? []),
      card,
    ]);
  }
  const attachedCalls = new Set(
    visible.flatMap((message) =>
      message.role === "assistant"
        ? (message.toolCalls ?? []).map((call) => call.id)
        : [],
    ),
  );

  return (
    <>
      {visible.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto flex min-h-full w-full max-w-205 flex-col px-4 sm:px-8">
            <Welcome onSend={onSend} />
            {recoveryIssue && <RecoveryNotice issue={recoveryIssue} />}
          </div>
        </div>
      ) : (
        <MessageScrollerProvider autoScroll defaultScrollPosition="end">
          <MessageScroller className="min-h-0 flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent className="mx-auto w-full max-w-205 gap-8 px-4 pt-8 pb-12 sm:px-8 sm:pt-12">
                {/* Checkpoint IDs can replace stream IDs at the same position. */}
                {visible.map((message, index) => (
                  <Fragment key={index}>
                    <MessageScrollerItem>
                      <MessageRow
                        message={message}
                        smoothText={animatedMessageId === message.id}
                      />
                    </MessageScrollerItem>
                    {message.role === "assistant" &&
                      message.toolCalls?.map((call) => {
                        return cardsByCall.get(call.id)?.map((card) => (
                          <MessageScrollerItem key={card.id}>
                            <Card card={card} />
                          </MessageScrollerItem>
                        ));
                      })}
                  </Fragment>
                ))}
                {cards
                  .filter(
                    (card) =>
                      !card.toolCallId || !attachedCalls.has(card.toolCallId),
                  )
                  .map((card) => (
                    <MessageScrollerItem key={card.id}>
                      <Card card={card} />
                    </MessageScrollerItem>
                  ))}
                {reviews.length > 0 && (
                  <MessageScrollerItem
                    key={reviews.map((review) => review.interruptId).join(",")}
                  >
                    <ReviewPanel
                      reviews={reviews}
                      running={running}
                      onReview={onReview}
                    />
                  </MessageScrollerItem>
                )}
                {running && visible.at(-1)?.role === "user" && (
                  <MessageScrollerItem key="thinking">
                    <Thinking />
                  </MessageScrollerItem>
                )}
                {recoveryIssue && (
                  <MessageScrollerItem key="recovery-issue">
                    <RecoveryNotice issue={recoveryIssue} />
                  </MessageScrollerItem>
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton
              size="icon-lg"
              className="size-11 rounded-xl"
            />
          </MessageScroller>
        </MessageScrollerProvider>
      )}
    </>
  );
}

function RecoveryNotice({ issue }: { issue: string }) {
  return (
    <Alert className="mb-3 rounded-xl border-amber-300 bg-amber-50 p-3 text-amber-900">
      <AlertDescription className="text-amber-900">{issue}</AlertDescription>
    </Alert>
  );
}
