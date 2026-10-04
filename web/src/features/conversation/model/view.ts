import type { A2UISurfaceView } from "@/features/a2ui";
import { isRunActive } from "@shared/run-status";
import { parsePlanReview } from "./planReview";
import { hasMessageText } from "./presentation";
import type { ConversationState } from "./state";
import { chatTurns } from "./turns";
import { workflowArtifacts } from "./workflowArtifacts";

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
  const surfacesByCall = new Map<string, A2UISurfaceView[]>();

  for (const view of surfaces) {
    if (view.toolCallId) {
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
    const turnReviews = index === turns.length - 1 ? reviews : [];
    const artifacts = workflowArtifacts(calls, views, turnReviews);
    const hasReply =
      turn.messages.some(
        (message) =>
          ((message.role === "assistant" || message.role === "reasoning") &&
            hasMessageText(message)) ||
          (message.role === "assistant" && Boolean(message.toolCalls?.length)),
      ) ||
      (turn.status !== null && isRunActive(turn.status)) ||
      views.length > 0 ||
      artifacts.reviews.length > 0;

    return {
      turn,
      artifacts,
      hasReply,
      // Partial results hide completed plans without remounting sibling drafts.
      reviewKey: turnReviews.map((review) => review.interruptId).join(","),
    };
  });
  const unattachedSurfaces = surfaces.filter(
    (view) => !view.toolCallId || !attachedCalls.has(view.toolCallId),
  );

  return {
    turns: replies,
    unattachedSurfaces,
    unattachedReviews: turns.length === 0 ? reviews : [],
    hasContent: turns.length > 0 || surfaces.length > 0 || reviews.length > 0,
  };
}
