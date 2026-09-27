import { Fragment, useEffect, useRef } from "react";
import { A2UICard } from "../a2ui/A2UICard";
import type { A2UICard as CardData } from "../a2ui/card";
import { Composer } from "./Composer";
import { MessageRow, Thinking } from "./MessageRow";
import { ReviewPanel } from "./ReviewPanel";
import type { ChatPaneProps } from "./types";
import { Welcome } from "./Welcome";

export function ChatPane({
  messages,
  cards,
  reviews,
  waitingForReview,
  running,
  recoveryIssue,
  onSend,
  onReview,
}: ChatPaneProps) {
  const scroll = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
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

  useEffect(() => {
    if (followOutput.current && scroll.current) {
      scroll.current.scrollTop = scroll.current.scrollHeight;
    }
  }, [messages, cards, reviews, running]);

  function updateScrollPosition() {
    const element = scroll.current;
    if (!element) return;
    followOutput.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 100;
  }

  return (
    <>
      <div
        ref={scroll}
        onScroll={updateScrollPosition}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex min-h-full w-full max-w-205 flex-col px-4 sm:px-8">
          {visible.length === 0 ? (
            <Welcome onSend={onSend} />
          ) : (
            <div className="space-y-8 pt-8 pb-12 sm:pt-12">
              {visible.map((message) => (
                <Fragment key={message.id}>
                  <MessageRow message={message} />
                  {message.role === "assistant" &&
                    message.toolCalls?.map((call) => {
                      return cardsByCall
                        .get(call.id)
                        ?.map((card) => <A2UICard key={card.id} card={card} />);
                    })}
                </Fragment>
              ))}
              {cards
                .filter(
                  (card) =>
                    !card.toolCallId || !attachedCalls.has(card.toolCallId),
                )
                .map((card) => (
                  <A2UICard key={card.id} card={card} />
                ))}
              {reviews.length > 0 && (
                <ReviewPanel
                  key={reviews.map((review) => review.interruptId).join(",")}
                  reviews={reviews}
                  running={running}
                  onReview={onReview}
                />
              )}
              {running && visible.at(-1)?.role === "user" && <Thinking />}
              {recoveryIssue && (
                <p
                  role="alert"
                  className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                >
                  {recoveryIssue}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      <Composer
        running={running}
        waitingForReview={waitingForReview}
        onSend={onSend}
      />
    </>
  );
}
