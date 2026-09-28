import { Fragment, lazy, Suspense, useMemo } from "react";
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
import type { A2UISurfaceView } from "../a2ui/runtime";
import { MessageRow, Thinking } from "./MessageRow";
import { hasMessageText, waitingForAssistantText } from "./presentation";
import { ReviewPanel } from "./ReviewPanel";
import { useConversation } from "../conversation/useConversation";
import { parsePlanReview } from "../conversation/planReview";
import { Welcome } from "./Welcome";

const A2UISurface = lazy(() =>
  import("../a2ui/A2UISurface").then(({ A2UISurface }) => ({
    default: A2UISurface,
  })),
);

function Surface({ view }: { view: A2UISurfaceView }) {
  return (
    <Suspense fallback={null}>
      <A2UISurface view={view} />
    </Suspense>
  );
}

export function ChatPane() {
  const {
    messages,
    surfaces,
    pendingInterrupts,
    running,
    animatedMessageId,
    recoveryIssue,
    onSend,
    onReview,
  } = useConversation(
    useShallow((state) => ({
      messages: state.messages,
      surfaces: state.surfaces,
      pendingInterrupts: state.pendingInterrupts,
      running: state.running,
      animatedMessageId: state.animatedMessageId,
      recoveryIssue:
        state.snapshotIssue ?? state.a2uiIssue ?? state.recoveryIssue,
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

  const visible = messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );
  const waiting = waitingForAssistantText(visible, running);
  const surfacesByCall = new Map<string, A2UISurfaceView[]>();

  for (const view of surfaces) {
    if (!view.toolCallId) {
      continue;
    }

    surfacesByCall.set(view.toolCallId, [
      ...(surfacesByCall.get(view.toolCallId) ?? []),
      view,
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
      {visible.length === 0 && surfaces.length === 0 && reviews.length === 0 ? (
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
                    {hasMessageText(message) && (
                      <MessageScrollerItem>
                        <MessageRow
                          message={message}
                          smoothText={animatedMessageId === message.id}
                        />
                      </MessageScrollerItem>
                    )}
                    {message.role === "assistant" &&
                      message.toolCalls?.map((call) => {
                        return surfacesByCall.get(call.id)?.map((view) => (
                          <MessageScrollerItem key={view.id}>
                            <Surface view={view} />
                          </MessageScrollerItem>
                        ));
                      })}
                  </Fragment>
                ))}
                {surfaces
                  .filter(
                    (view) =>
                      !view.toolCallId || !attachedCalls.has(view.toolCallId),
                  )
                  .map((view) => (
                    <MessageScrollerItem key={view.id}>
                      <Surface view={view} />
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
                {waiting && (
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
