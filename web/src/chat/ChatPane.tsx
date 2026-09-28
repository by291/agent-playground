import { lazy, Suspense, useMemo } from "react";
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
import { MessageRow } from "./MessageRow";
import { AssistantReply } from "./AssistantReply";
import { chatTurns } from "./turns";
import { hasMessageText } from "./presentation";
import { isRunActive } from "../../../shared/run-status";
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
    runs,
    surfaces,
    pendingInterrupts,
    running,
    recovering,
    empty,
    animatedMessageId,
    recoveryIssue,
    onSend,
    onReview,
  } = useConversation(
    useShallow((state) => ({
      messages: state.messages,
      runs: state.runs,
      surfaces: state.surfaces,
      pendingInterrupts: state.pendingInterrupts,
      running: state.running,
      recovering: state.recovering,
      empty: state.empty,
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

  const turns = chatTurns(messages, runs);
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
    messages.flatMap((message) =>
      message.role === "assistant"
        ? (message.toolCalls ?? []).map((call) => call.id)
        : [],
    ),
  );

  if (
    recovering &&
    !empty &&
    turns.length === 0 &&
    surfaces.length === 0 &&
    reviews.length === 0
  ) {
    return <ConversationPlaceholder issue={recoveryIssue} />;
  }

  return (
    <>
      {turns.length === 0 && surfaces.length === 0 && reviews.length === 0 ? (
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
                {turns.map((turn) => {
                  const calls = turn.messages.flatMap((message) =>
                    message.role === "assistant"
                      ? (message.toolCalls ?? [])
                      : [],
                  );
                  const views = calls.flatMap(
                    (call) => surfacesByCall.get(call.id) ?? [],
                  );
                  const hasReply =
                    turn.messages.some(
                      (message) =>
                        message.role === "assistant" &&
                        (hasMessageText(message) || message.toolCalls?.length),
                    ) ||
                    (turn.status !== null && isRunActive(turn.status)) ||
                    views.length > 0;

                  return (
                    <div key={turn.id} className="contents">
                      {turn.user && (
                        <MessageScrollerItem>
                          <MessageRow message={turn.user} />
                        </MessageScrollerItem>
                      )}
                      {hasReply && (
                        <MessageScrollerItem>
                          <AssistantReply
                            turn={turn}
                            animatedMessageId={animatedMessageId}
                          >
                            {views.length > 0
                              ? views.map((view) => (
                                  <Surface key={view.id} view={view} />
                                ))
                              : undefined}
                          </AssistantReply>
                        </MessageScrollerItem>
                      )}
                    </div>
                  );
                })}
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

function ConversationPlaceholder({ issue }: { issue: string | null }) {
  return (
    <div
      role="region"
      aria-label="Messages"
      aria-busy={!issue}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
      <div className="mx-auto w-full max-w-205 px-4 pt-8 pb-12 sm:px-8 sm:pt-12">
        <div aria-hidden="true" className="space-y-8 motion-safe:animate-pulse">
          <div className="ml-auto h-12 w-40 rounded-[20px] rounded-br-md bg-sidebar" />
          <div className="flex gap-3 sm:gap-4">
            <div className="size-8 shrink-0 rounded-xl bg-accent-soft" />
            <div className="flex-1 space-y-3 pt-2">
              <div className="h-3 w-2/5 rounded-full bg-sidebar" />
              <div className="h-3 w-4/5 rounded-full bg-sidebar" />
            </div>
          </div>
        </div>
        {issue && <RecoveryNotice issue={issue} />}
      </div>
    </div>
  );
}

function RecoveryNotice({ issue }: { issue: string }) {
  return (
    <Alert className="mb-3 rounded-xl border-amber-300 bg-amber-50 p-3 text-amber-900">
      <AlertDescription className="text-amber-900">{issue}</AlertDescription>
    </Alert>
  );
}
