import type { ExternalTaskSnapshot } from "@shared/external-task";
import { workflowCatalog, type A2UISurfaceView } from "@/features/a2ui/index";
import { isRunActive } from "@shared/run-status";
import { parsePlanReview } from "./plan-review";
import { hasMessageText } from "./presentation";
import type { ConversationState } from "./state";
import { chatTurns } from "./turns";
import { workflowArtifacts } from "./workflow-artifacts";
import { parseWorkflowReview } from "@shared/workflow-review";

type ViewInput = Pick<
  ConversationState,
  "messages" | "runs" | "surfaces" | "pendingInterrupts"
> & { externalTasks?: ExternalTaskSnapshot[] };

function isDuplicateA2aResult(
  view: A2UISurfaceView,
  tasks: ExternalTaskSnapshot[],
) {
  const task = tasks.find(
    (candidate) =>
      candidate.kind === "a2a" && candidate.workflowCallId === view.toolCallId,
  );
  const revision = task?.outputs?.find(
    (output) =>
      output.step === "revise" &&
      output.status === "succeeded" &&
      output.text.trim(),
  );
  const legacySurface =
    task &&
    view.surface.id === `a2a-${task.workflowCallId}-result` &&
    view.surface.catalog.id === workflowCatalog.id;

  if (!legacySurface || !revision) {
    return false;
  }

  const steps = view.surface.componentsModel.get("steps");
  const children: unknown = steps?.properties.children;

  if (steps?.type !== "WorkflowSteps" || !Array.isArray(children)) {
    return false;
  }

  const lines: string[] = [];

  for (const childId of children as unknown[]) {
    if (typeof childId !== "string") {
      return false;
    }

    const component = view.surface.componentsModel.get(childId);
    const role: unknown = component?.properties.role;
    const text: unknown = component?.properties.text;

    if (
      component?.type !== "WorkflowText" ||
      role !== "step" ||
      typeof text !== "string"
    ) {
      return false;
    }

    lines.push(text);
  }

  return (
    lines.join("\n").replace(/\r\n?/g, "\n").trim() ===
    revision.text.replace(/\r\n?/g, "\n").trim()
  );
}

export function conversationView({
  messages,
  runs,
  surfaces,
  pendingInterrupts,
  externalTasks = [],
}: ViewInput) {
  const duplicateA2aResults = new Set(
    surfaces
      .filter((view) => isDuplicateA2aResult(view, externalTasks))
      .map((view) => view.id),
  );
  const reviews = pendingInterrupts.flatMap((interrupt) => {
    const review = parsePlanReview(interrupt);

    return review ? [review] : [];
  });
  const turns = chatTurns(messages, runs);
  const workflowReviews = pendingInterrupts.flatMap((interrupt) => {
    const review = parseWorkflowReview(interrupt);

    return review ? [review] : [];
  });
  const latest = new Map<string, A2UISurfaceView>();
  const history: A2UISurfaceView[] = [];
  const owners = new Map<string, string>();
  const grouped = new Set<string>();

  for (const view of surfaces) {
    const presentation = view.presentation;

    if (!presentation) {
      continue;
    }

    grouped.add(view.id);
    const previous = latest.get(presentation.groupId);

    if (previous) {
      history.push(previous);
    }

    latest.set(presentation.groupId, view);
    const replyOwner = turns.find((turn) =>
      turn.messages.some(
        (message) => message.id === presentation.anchorMessageId,
      ),
    );
    const toolOwner = turns.find((turn) =>
      turn.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.toolCalls?.some((call) => call.id === view.toolCallId),
      ),
    );
    const owner = replyOwner ?? toolOwner;

    if (owner) {
      owners.set(presentation.groupId, owner.id);
    }
  }

  const surfacesByCall = new Map<string, A2UISurfaceView[]>();

  for (const view of surfaces) {
    if (view.toolCallId && !grouped.has(view.id)) {
      const owned = surfacesByCall.get(view.toolCallId) ?? [];

      owned.push(view);
      surfacesByCall.set(view.toolCallId, owned);
    }
  }

  const attachedCalls = new Set<string>();
  const replies = turns.map((turn, index) => {
    const calls = turn.messages.flatMap((message) =>
      message.role === "assistant" ? (message.toolCalls ?? []) : [],
    );

    for (const call of calls) {
      attachedCalls.add(call.id);
    }

    const views = calls.flatMap((call) => surfacesByCall.get(call.id) ?? []);
    const turnWorkflowReviews =
      index === turns.length - 1 ? workflowReviews : [];

    for (const [groupId, groupedView] of latest) {
      if (owners.get(groupId) === turn.id) {
        views.push(groupedView);
      }
    }

    const turnReviews = index === turns.length - 1 ? reviews : [];
    const artifacts = workflowArtifacts(calls, views, turnReviews);
    const callIds = new Set(calls.map((call) => call.id));
    const turnTasks = externalTasks.filter((task) =>
      callIds.has(task.workflowCallId),
    );

    artifacts.history.push(
      ...history.filter(
        (view) => view.toolCallId && callIds.has(view.toolCallId),
      ),
    );

    // Keep protocol/archive surfaces and presentation ownership intact. Only the
    // rendered composition omits legacy result text already owned by a child.
    artifacts.current = artifacts.current.filter(
      (view) => !duplicateA2aResults.has(view.id),
    );
    artifacts.history = artifacts.history.filter(
      (view) => !duplicateA2aResults.has(view.id),
    );

    const hasReply =
      turn.messages.some(
        (message) =>
          ((message.role === "assistant" || message.role === "reasoning") &&
            hasMessageText(message)) ||
          (message.role === "assistant" && Boolean(message.toolCalls?.length)),
      ) ||
      (turn.status !== null && isRunActive(turn.status)) ||
      views.length > 0 ||
      artifacts.reviews.length > 0 ||
      turnWorkflowReviews.length > 0 ||
      turnTasks.length > 0;

    return {
      turn,
      externalTasks: turnTasks,
      artifacts,
      hasReply,
      workflowReviews: turnWorkflowReviews,
      // Partial results hide completed plans without remounting sibling drafts.
      reviewKey: turnReviews.map((review) => review.interruptId).join(","),
    };
  });
  const unattachedSurfaces = [
    ...surfaces.filter(
      (view) =>
        !grouped.has(view.id) &&
        (!view.toolCallId || !attachedCalls.has(view.toolCallId)),
    ),
    ...[...latest]
      .filter(([groupId]) => !owners.has(groupId))
      .map(([, view]) => view),
  ].filter((view) => !duplicateA2aResults.has(view.id));

  return {
    turns: replies,
    unattachedTasks: externalTasks.filter(
      (task) => !attachedCalls.has(task.workflowCallId),
    ),
    unattachedSurfaces,
    unattachedReviews: turns.length === 0 ? reviews : [],
    unattachedWorkflowReviews: turns.length === 0 ? workflowReviews : [],
    hasContent:
      turns.length > 0 ||
      surfaces.length > 0 ||
      reviews.length > 0 ||
      workflowReviews.length > 0 ||
      externalTasks.length > 0,
  };
}
