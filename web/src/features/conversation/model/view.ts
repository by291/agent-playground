import type { A2UISurfaceView } from "@/features/a2ui";
import { isRunActive } from "@shared/run-status";
import { parsePlanReview } from "./planReview";
import { hasMessageText } from "./presentation";
import type { ConversationState } from "./state";
import { chatTurns } from "./turns";
import { workflowArtifacts } from "./workflowArtifacts";
import { parseSqlReview, sqlCardSchema } from "@shared/sql-review";

type ViewInput = Pick<
  ConversationState,
  "messages" | "runs" | "surfaces" | "pendingInterrupts"
>;

export function conversationView({
  messages,
  runs,
  surfaces,
  pendingInterrupts,
}: ViewInput) {
  const reviews = pendingInterrupts.flatMap((interrupt) => {
    const review = parsePlanReview(interrupt);

    return review ? [review] : [];
  });
  const turns = chatTurns(messages, runs);
  const sqlReviews = pendingInterrupts.flatMap((interrupt) => {
    const review = parseSqlReview(interrupt);

    return review ? [review] : [];
  });
  const latestSql = new Map<string, A2UISurfaceView>();
  const sqlHistory: A2UISurfaceView[] = [];
  const sqlOwners = new Map<string, string>();
  const sqlViews = new Set<string>();

  for (const view of surfaces) {
    const component = view.surface.componentsModel.get("root");
    const card =
      component?.type === "WorkflowSql"
        ? sqlCardSchema.safeParse(component.properties)
        : null;

    if (!card?.success) {
      continue;
    }

    sqlViews.add(view.id);
    const previous = latestSql.get(card.data.workflowCallId);

    if (previous) {
      sqlHistory.push(previous);
    }

    latestSql.set(card.data.workflowCallId, view);
    const owner = turns.find((turn) =>
      turn.messages.some((message) => message.id === card.data.replyId),
    );

    if (owner) {
      sqlOwners.set(card.data.workflowCallId, owner.id);
    }
  }

  const surfacesByCall = new Map<string, A2UISurfaceView[]>();

  for (const view of surfaces) {
    if (view.toolCallId && !sqlViews.has(view.id)) {
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
    const turnSqlReviews = index === turns.length - 1 ? sqlReviews : [];

    for (const [callId, sqlView] of latestSql) {
      const owner = sqlOwners.get(callId);

      if (owner === turn.id || (!owner && index === turns.length - 1)) {
        views.push(sqlView);
      }
    }

    const turnReviews = index === turns.length - 1 ? reviews : [];
    const artifacts = workflowArtifacts(calls, views, turnReviews);
    const sqlCalls = new Set(
      calls
        .filter((call) => call.function.name === "run_sql_workflow")
        .map((call) => call.id),
    );

    artifacts.history.push(
      ...sqlHistory.filter(
        (view) => view.toolCallId && sqlCalls.has(view.toolCallId),
      ),
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
      turnSqlReviews.length > 0;

    return {
      turn,
      artifacts,
      hasReply,
      sqlReviews: turnSqlReviews,
      // Partial results hide completed plans without remounting sibling drafts.
      reviewKey: turnReviews.map((review) => review.interruptId).join(","),
    };
  });
  const unattachedSurfaces = surfaces.filter(
    (view) =>
      !sqlViews.has(view.id) &&
      (!view.toolCallId || !attachedCalls.has(view.toolCallId)),
  );

  return {
    turns: replies,
    unattachedSurfaces,
    unattachedReviews: turns.length === 0 ? reviews : [],
    unattachedSqlReviews: turns.length === 0 ? sqlReviews : [],
    hasContent:
      turns.length > 0 ||
      surfaces.length > 0 ||
      reviews.length > 0 ||
      sqlReviews.length > 0,
  };
}
