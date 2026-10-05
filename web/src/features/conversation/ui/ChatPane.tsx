import { parseExternalWait } from "@shared/external-task";
import { conversationView } from "../model/view";
import {
  isRunning,
  isRestoring,
  isEmpty,
  conversationIssue,
} from "../model/selectors";
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
import type { A2UISurfaceView } from "@/features/a2ui";
import { MessageRow } from "./messages/MessageRow";
import { AssistantReply } from "./messages/AssistantReply";
import { ReviewPanel } from "./review/ReviewPanel";
import { ExternalTaskPanel } from "./ExternalTaskPanel";
import { WorkflowReviewPanel } from "./review/WorkflowReviewPanel";
import { useConversation } from "../ConversationProvider";
import { Welcome } from "./Welcome";
import { isRunActive } from "@shared/run-status";
import { AnimatePresence } from "motion/react";
import { AnimatedDiv } from "@/components/ui/motion";

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

export function ChatPane({
  onSelectPrompt,
}: { onSelectPrompt?: (prompt: string) => void } = {}) {
  const {
    messages,
    externalTasks,
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
    onWorkflowReview,
  } = useConversation(
    useShallow((state) => ({
      messages: state.messages,
      externalTasks: state.externalTasks,
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
      onWorkflowReview: state.reviewWorkflow,
    })),
  );
  const activeMessageIds = new Set(
    runs.filter((run) => isRunActive(run.status)).map((run) => run.messageId),
  );
  const view = useMemo(
    () =>
      conversationView({
        messages,
        runs,
        surfaces,
        pendingInterrupts,
        externalTasks,
      }),
    [messages, runs, surfaces, pendingInterrupts, externalTasks],
  );
  const externalWaitCallIds = pendingInterrupts.flatMap((interrupt) => {
    const wait = parseExternalWait(interrupt);

    return wait ? [wait.workflowCallId] : [];
  });
  const {
    turns,
    unattachedTasks,
    unattachedSurfaces,
    unattachedReviews,
    unattachedWorkflowReviews,
    hasContent,
  } = view;

  if (recovering && !empty && !hasContent) {
    return <ConversationPlaceholder issue={recoveryIssue} />;
  }

  return (
    <>
      {!hasContent ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-8">
          <div className="conversation-layout conversation-column flex min-h-full flex-col">
            <Welcome
              onSelect={onSelectPrompt ?? ((prompt) => void onSend(prompt))}
            />
            {recoveryIssue && <RecoveryNotice issue={recoveryIssue} />}
          </div>
        </div>
      ) : (
        <MessageScrollerProvider autoScroll defaultScrollPosition="end">
          <MessageScroller className="min-h-0 flex-1">
            <MessageScrollerViewport className="px-4 sm:px-8">
              <MessageScrollerContent className="motion-content-enter conversation-layout gap-8 pt-8 pb-12 sm:pt-12">
                {turns.map(
                  ({
                    turn,
                    artifacts,
                    hasReply,
                    reviewKey,
                    workflowReviews,
                    externalTasks: turnTasks,
                  }) => {
                    return (
                      <Fragment key={turn.id}>
                        {turn.user && (
                          <MessageScrollerItem className="conversation-column">
                            <div
                              className={
                                activeMessageIds.has(turn.user.id)
                                  ? "motion-item-enter"
                                  : undefined
                              }
                            >
                              <MessageRow message={turn.user} />
                            </div>
                          </MessageScrollerItem>
                        )}
                        {hasReply && (
                          <MessageScrollerItem className="conversation-column">
                            <AssistantReply
                              turn={turn}
                              externalWaitCallIds={externalWaitCallIds}
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
                              <AnimatePresence initial={false}>
                                {turnTasks.map((task) => (
                                  <AnimatedDiv
                                    key={task.taskId}
                                    exit={{
                                      opacity: 0,
                                      height: 0,
                                      overflow: "hidden",
                                    }}
                                  >
                                    <ExternalTaskPanel task={task} />
                                  </AnimatedDiv>
                                ))}
                                {artifacts.current.map((view) => (
                                  <AnimatedDiv
                                    key={view.id}
                                    exit={{
                                      opacity: 0,
                                      height: 0,
                                      overflow: "hidden",
                                    }}
                                  >
                                    <Surface view={view} inChat={false} />
                                  </AnimatedDiv>
                                ))}
                                {artifacts.reviews.length > 0 && (
                                  <AnimatedDiv
                                    key={reviewKey}
                                    exit={{
                                      opacity: 0,
                                      height: 0,
                                      overflow: "hidden",
                                    }}
                                  >
                                    <ReviewPanel
                                      reviews={artifacts.reviews}
                                      running={running}
                                      onReview={onReview}
                                    />
                                  </AnimatedDiv>
                                )}
                                {workflowReviews.length > 0 && (
                                  <AnimatedDiv
                                    key="workflow-reviews"
                                    exit={{
                                      opacity: 0,
                                      height: 0,
                                      overflow: "hidden",
                                    }}
                                  >
                                    <WorkflowReviewPanel
                                      reviews={workflowReviews}
                                      running={running}
                                      onReview={onWorkflowReview}
                                    />
                                  </AnimatedDiv>
                                )}
                              </AnimatePresence>
                            </AssistantReply>
                          </MessageScrollerItem>
                        )}
                      </Fragment>
                    );
                  },
                )}
                <AnimatePresence initial={false}>
                  {unattachedTasks.map((task) => (
                    <MessageScrollerItem
                      className="conversation-column"
                      key={task.taskId}
                    >
                      <AnimatedDiv
                        exit={{ opacity: 0, height: 0, overflow: "hidden" }}
                      >
                        <ExternalTaskPanel task={task} />
                      </AnimatedDiv>
                    </MessageScrollerItem>
                  ))}
                  {unattachedSurfaces.map((view) => (
                    <MessageScrollerItem
                      key={view.id}
                      className="conversation-column"
                    >
                      <AnimatedDiv
                        exit={{ opacity: 0, height: 0, overflow: "hidden" }}
                      >
                        <Surface view={view} />
                      </AnimatedDiv>
                    </MessageScrollerItem>
                  ))}
                  {unattachedReviews.length > 0 && (
                    <MessageScrollerItem
                      className="conversation-column"
                      key={unattachedReviews
                        .map((review) => review.interruptId)
                        .join(",")}
                    >
                      <AnimatedDiv
                        exit={{ opacity: 0, height: 0, overflow: "hidden" }}
                      >
                        <ReviewPanel
                          reviews={unattachedReviews}
                          running={running}
                          onReview={onReview}
                        />
                      </AnimatedDiv>
                    </MessageScrollerItem>
                  )}
                  {unattachedWorkflowReviews.length > 0 && (
                    <MessageScrollerItem
                      key="unattached-workflow-reviews"
                      className="conversation-column"
                    >
                      <AnimatedDiv
                        exit={{ opacity: 0, height: 0, overflow: "hidden" }}
                      >
                        <WorkflowReviewPanel
                          reviews={unattachedWorkflowReviews}
                          running={running}
                          onReview={onWorkflowReview}
                        />
                      </AnimatedDiv>
                    </MessageScrollerItem>
                  )}
                </AnimatePresence>
                {recoveryIssue && (
                  <MessageScrollerItem
                    key="recovery-issue"
                    className="conversation-column"
                  >
                    <RecoveryNotice issue={recoveryIssue} />
                  </MessageScrollerItem>
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton
              size="icon-lg"
              className="size-10 rounded-md"
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
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-8"
    >
      <div className="conversation-layout conversation-column pt-8 pb-12 sm:pt-12">
        <div aria-hidden="true" className="space-y-8 motion-safe:animate-pulse">
          <div className="ml-auto h-12 w-40 rounded-lg bg-sidebar" />
          <div className="relative flex">
            <div className="absolute top-0 -left-12 hidden size-8 rounded-md bg-sidebar sm:block" />
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
