import { conversationView } from "../model/view";
import {
  isRunning,
  isRestoring,
  isEmpty,
  conversationIssue,
} from "../model/selectors";
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
import type { A2UISurfaceView } from "@/features/a2ui";
import { MessageRow } from "./messages/MessageRow";
import { AssistantReply } from "./messages/AssistantReply";
import { ReviewPanel } from "./review/ReviewPanel";
import { useConversation } from "../ConversationProvider";
import { Welcome } from "./Welcome";

const A2UISurface = lazy(() =>
  import("@/features/a2ui/A2UISurface").then(({ A2UISurface }) => ({
    default: A2UISurface,
  })),
);

function Surface({
  view,
  inChat = true,
}: {
  view: A2UISurfaceView;
  inChat?: boolean;
}) {
  return (
    <Suspense fallback={null}>
      <A2UISurface view={view} inChat={inChat} />
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
      running: isRunning(state),
      recovering: isRestoring(state),
      empty: isEmpty(state),
      animatedMessageId: state.animatedMessageId,
      recoveryIssue: conversationIssue(state),
      onSend: state.send,
      onReview: state.reviewPlan,
    })),
  );
  const view = useMemo(
    () => conversationView({ messages, runs, surfaces, pendingInterrupts }),
    [messages, runs, surfaces, pendingInterrupts],
  );
  const { turns, unattachedSurfaces, unattachedReviews, hasContent } = view;

  if (recovering && !empty && !hasContent) {
    return <ConversationPlaceholder issue={recoveryIssue} />;
  }

  return (
    <>
      {!hasContent ? (
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
                {turns.map(({ turn, artifacts, hasReply, reviewKey }) => {
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
                            processDetails={
                              artifacts.history.length > 0 && (
                                <div className="space-y-3 pt-2">
                                  <p className="px-2 text-xs font-medium text-muted">
                                    Previous workflow steps
                                  </p>
                                  {artifacts.history.map((view) => (
                                    <Surface
                                      key={view.id}
                                      view={view}
                                      inChat={false}
                                    />
                                  ))}
                                </div>
                              )
                            }
                          >
                            {artifacts.current.map((view) => (
                              <Surface
                                key={view.id}
                                view={view}
                                inChat={false}
                              />
                            ))}
                            {artifacts.reviews.length > 0 && (
                              <ReviewPanel
                                key={reviewKey}
                                reviews={artifacts.reviews}
                                running={running}
                                onReview={onReview}
                              />
                            )}
                          </AssistantReply>
                        </MessageScrollerItem>
                      )}
                    </div>
                  );
                })}
                {unattachedSurfaces.map((view) => (
                  <MessageScrollerItem key={view.id}>
                    <Surface view={view} />
                  </MessageScrollerItem>
                ))}
                {unattachedReviews.length > 0 && (
                  <MessageScrollerItem
                    key={unattachedReviews
                      .map((review) => review.interruptId)
                      .join(",")}
                  >
                    <ReviewPanel
                      reviews={unattachedReviews}
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
