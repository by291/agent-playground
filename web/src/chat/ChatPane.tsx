import { Fragment } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
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
  animatedMessageId,
  recoveryIssue,
  onSend,
  onReview,
}: ChatPaneProps) {
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
                            <A2UICard card={card} />
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
                      <A2UICard card={card} />
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
                    <Alert className="rounded-xl border-amber-300 bg-amber-50 p-3 text-amber-900">
                      <AlertDescription className="text-amber-900">
                        {recoveryIssue}
                      </AlertDescription>
                    </Alert>
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
      <Composer
        running={running}
        waitingForReview={waitingForReview}
        onSend={onSend}
      />
    </>
  );
}
