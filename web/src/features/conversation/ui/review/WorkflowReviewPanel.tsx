import { Button } from "@/components/ui/button";
import type { WorkflowReview } from "@shared/workflow-review";

export function WorkflowReviewPanel({
  reviews,
  running,
  onReview,
}: {
  reviews: WorkflowReview[];
  running: boolean;
  onReview: (
    review: WorkflowReview,
    action: "accept" | "abandon",
  ) => Promise<void>;
}) {
  return (
    <div className="space-y-3">
      {reviews.map((review) => (
        <section
          key={review.interruptId}
          aria-label={review.title}
          className="space-y-3 rounded-lg border border-line bg-surface p-4"
        >
          <p className="text-sm/6 text-muted">
            {reviews.length === 1
              ? "Continue the discussion below, accept this version, or abandon it."
              : "Multiple workflow reviews are pending. Decide on each workflow before continuing the discussion."}
          </p>
          {!review.canAccept && (
            <p className="text-xs/5 text-muted">
              {review.blockedReason ?? "This version cannot be accepted yet."}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={running || !review.canAccept}
              onClick={() => void onReview(review, "accept")}
            >
              {review.acceptLabel}
            </Button>
            <Button
              variant="outline"
              disabled={running}
              onClick={() => void onReview(review, "abandon")}
            >
              Abandon
            </Button>
          </div>
        </section>
      ))}
    </div>
  );
}
