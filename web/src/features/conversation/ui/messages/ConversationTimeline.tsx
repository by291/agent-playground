import { parseExternalWait } from "@shared/external-task";
import { conversationView } from "../../model/conversation-view";
import {
  isRunning,
  isRestoring,
  isEmpty,
  conversationIssue,
} from "../../model/selectors";
import { lazy, Suspense, useMemo, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import type { A2UISurfaceView } from "@/features/a2ui/index";
import { MessageRow } from "./MessageRow";
import { AssistantReply } from "./AssistantReply";
import { ReviewPanel } from "../review/ReviewPanel";
import { ExternalTaskPanel } from "../outputs/ExternalTaskPanel";
import { WorkflowReviewPanel } from "../review/WorkflowReviewPanel";
import { useConversation } from "../../providers/ConversationProvider";
import type { ConversationState } from "../../model/state";
import { ConversationWelcome } from "./ConversationWelcome";
import { isRunActive } from "@shared/run-status";
import { AnimatePresence } from "motion/react";
import { AnimatedDiv } from "@/components/ui/motion";

const A2UISurface = lazy(() =>
  import("@/features/a2ui/A2UISurface").then(({ A2UISurface }) => ({
    default: A2UISurface,
  })),
);

const artifactExit = {
  opacity: 0,
  height: 0,
  overflow: "hidden",
};

type TimelineView = ReturnType<typeof conversationView>;

interface TurnPresentation {
  threadId: ConversationState["threadId"];
  messageTimestamps: ConversationState["messageTimestamps"];
  activeMessageIds: ReadonlySet<string | undefined>;
  externalWaitCallIds: readonly string[];
  animatedMessageId: ConversationState["animatedMessageId"];
}

interface ReviewControls {
  running: boolean;
  onReview: ConversationState["reviewPlan"];
  onWorkflowReview: ConversationState["reviewWorkflow"];
}

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

function WorkflowHistory({ surfaces }: { surfaces: A2UISurfaceView[] }) {
  return (
    <div className="space-y-3 pt-2">
      <p className="px-2 text-xs font-medium text-muted">
        Previous workflow steps
      </p>
      {surfaces.map((view) => (
        <Surface key={view.id} view={view} inChat={false} />
      ))}
    </div>
  );
}

function TimelineTurn({
  reply,
  presentation,
  reviewControls,
}: {
  reply: TimelineView["turns"][number];
  presentation: TurnPresentation;
  reviewControls: ReviewControls;
}) {
  const {
    turn,
    hasReply,
    artifacts,
    externalTasks,
    reviewKey,
    workflowReviews,
  } = reply;
  const { user } = turn;
  const {
    threadId,
    activeMessageIds,
    messageTimestamps,
    externalWaitCallIds,
    animatedMessageId,
  } = presentation;

  const { running, onReview, onWorkflowReview } = reviewControls;

  // Each message must remain a direct DOM child of the measured scroll content.
  return (
    <>
      {user && (
        <MessageScrollerItem className="conversation-column">
          <div
            className={
              activeMessageIds.has(user.id) ? "motion-item-enter" : undefined
            }
          >
            <MessageRow
              message={user}
              timestamp={messageTimestamps[user.id]}
              threadId={threadId}
            />
          </div>
        </MessageScrollerItem>
      )}

      {hasReply && (
        <MessageScrollerItem className="conversation-column">
          <AssistantReply
            turn={turn}
            messageTimestamps={messageTimestamps}
            externalWaitCallIds={externalWaitCallIds}
            animatedMessageId={animatedMessageId}
            processDetails={
              artifacts.history.length > 0 && (
                <WorkflowHistory surfaces={artifacts.history} />
              )
            }
          >
            <AnimatePresence initial={false}>
              {externalTasks.map((task) => (
                <AnimatedDiv key={task.taskId} exit={artifactExit}>
                  <ExternalTaskPanel task={task} />
                </AnimatedDiv>
              ))}
              {artifacts.current.map((view) => (
                <AnimatedDiv key={view.id} exit={artifactExit}>
                  <Surface view={view} inChat={false} />
                </AnimatedDiv>
              ))}

              {artifacts.reviews.length > 0 && (
                <AnimatedDiv key={reviewKey} exit={artifactExit}>
                  <ReviewPanel
                    reviews={artifacts.reviews}
                    running={running}
                    onReview={onReview}
                  />
                </AnimatedDiv>
              )}
              {workflowReviews.length > 0 && (
                <AnimatedDiv key="workflow-reviews" exit={artifactExit}>
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
    </>
  );
}

function TimelineArtifact({ children }: { children: ReactNode }) {
  return (
    <MessageScrollerItem className="conversation-column">
      <AnimatedDiv exit={artifactExit}>{children}</AnimatedDiv>
    </MessageScrollerItem>
  );
}

function UnattachedArtifacts({
  view,
  reviewControls,
}: {
  view: TimelineView;
  reviewControls: ReviewControls;
}) {
  const {
    unattachedTasks,
    unattachedSurfaces,
    unattachedReviews,
    unattachedWorkflowReviews,
  } = view;
  const { running, onReview, onWorkflowReview } = reviewControls;

  const reviewKey = unattachedReviews
    .map((review) => review.interruptId)
    .join(",");

  return (
    <AnimatePresence initial={false}>
      {unattachedTasks.map((task) => (
        <TimelineArtifact key={task.taskId}>
          <ExternalTaskPanel task={task} />
        </TimelineArtifact>
      ))}
      {unattachedSurfaces.map((surface) => (
        <TimelineArtifact key={surface.id}>
          <Surface view={surface} />
        </TimelineArtifact>
      ))}

      {unattachedReviews.length > 0 && (
        <TimelineArtifact key={reviewKey}>
          <ReviewPanel
            reviews={unattachedReviews}
            running={running}
            onReview={onReview}
          />
        </TimelineArtifact>
      )}
      {unattachedWorkflowReviews.length > 0 && (
        <TimelineArtifact key="unattached-workflow-reviews">
          <WorkflowReviewPanel
            reviews={unattachedWorkflowReviews}
            running={running}
            onReview={onWorkflowReview}
          />
        </TimelineArtifact>
      )}
    </AnimatePresence>
  );
}

/** Composes the saved transcript, live outputs and recovery controls in scroll order. */
export function ConversationTimeline({
  onSelectPrompt,
}: { onSelectPrompt?: (prompt: string) => void } = {}) {
  const {
    threadId,
    messages,
    messageTimestamps,
    externalTasks,
    runs,
    surfaces,
    pendingInterrupts,
    running,
    recovering,
    empty,
    animatedMessageId,
    recoveryIssue,
    canRetryPreparedSubmission,
    retryPreparedSubmission,
    onSend,
    onReview,
    onWorkflowReview,
  } = useConversation(
    useShallow((state) => ({
      threadId: state.threadId,
      messages: state.messages,
      messageTimestamps: state.messageTimestamps,
      externalTasks: state.externalTasks,
      runs: state.runs,
      surfaces: state.surfaces,
      pendingInterrupts: state.pendingInterrupts,
      running: isRunning(state),
      recovering: isRestoring(state),
      empty: isEmpty(state),
      animatedMessageId: state.animatedMessageId,
      recoveryIssue: conversationIssue(state),
      canRetryPreparedSubmission: state.canRetryPreparedSubmission,
      retryPreparedSubmission: state.retryPreparedSubmission,
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
    /* prettier-ignore */ [
      messages,
      runs,
      surfaces,
      pendingInterrupts,
      externalTasks,
    ],
  );
  const externalWaitCallIds = pendingInterrupts.flatMap((interrupt) => {
    const wait = parseExternalWait(interrupt);

    return wait ? [wait.workflowCallId] : [];
  });
  const { turns, hasContent } = view;

  const presentation = {
    threadId,
    messageTimestamps,
    activeMessageIds,
    externalWaitCallIds,
    animatedMessageId,
  };
  const reviewControls = {
    running,
    onReview,
    onWorkflowReview,
  };

  // Retrying reuses the existing journal even when there is no current error message.
  const hasRecoveryNotice =
    recoveryIssue !== null || canRetryPreparedSubmission;
  const recoveryNotice = hasRecoveryNotice && (
    <RecoveryNotice
      issue={recoveryIssue}
      onRetry={
        canRetryPreparedSubmission
          ? () => void retryPreparedSubmission().catch(() => undefined)
          : undefined
      }
    />
  );

  if (recovering && !empty && !hasContent) {
    return (
      <ConversationPlaceholder issue={recoveryIssue}>
        {recoveryNotice}
      </ConversationPlaceholder>
    );
  }

  return (
    <>
      {!hasContent ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-8">
          <div className="conversation-layout conversation-column flex min-h-full flex-col">
            <ConversationWelcome
              onSelect={
                onSelectPrompt ??
                ((prompt) => void onSend(prompt).catch(() => undefined))
              }
            />
            {recoveryNotice}
          </div>
        </div>
      ) : (
        <MessageScrollerProvider autoScroll defaultScrollPosition="end">
          <MessageScroller className="min-h-0 flex-1">
            <MessageScrollerViewport className="px-4 sm:px-8">
              <MessageScrollerContent className="motion-content-enter conversation-layout gap-8 pt-8 pb-12 sm:pt-12">
                {turns.map((reply) => (
                  <TimelineTurn
                    key={reply.turn.id}
                    reply={reply}
                    presentation={presentation}
                    reviewControls={reviewControls}
                  />
                ))}

                <UnattachedArtifacts
                  view={view}
                  reviewControls={reviewControls}
                />

                {recoveryNotice && (
                  <MessageScrollerItem
                    key="recovery-issue"
                    className="conversation-column"
                  >
                    {recoveryNotice}
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

function ConversationPlaceholder({
  issue,
  children,
}: {
  issue: string | null;
  children?: ReactNode;
}) {
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
        {children}
      </div>
    </div>
  );
}

function RecoveryNotice({
  issue,
  onRetry,
}: {
  issue: string | null;
  onRetry: (() => void) | undefined;
}) {
  return (
    <Alert className="mb-3 rounded-xl border-amber-300 bg-amber-50 p-3 text-amber-900">
      {issue && (
        <AlertDescription className="text-amber-900">{issue}</AlertDescription>
      )}

      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry submission
        </Button>
      )}
    </Alert>
  );
}
