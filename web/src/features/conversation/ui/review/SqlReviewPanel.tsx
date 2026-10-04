import { Button } from "@/components/ui/button";
import type { SqlReview } from "@shared/sql-review";

export function SqlReviewPanel({
  reviews,
  running,
  onReview,
}: {
  reviews: SqlReview[];
  running: boolean;
  onReview: (review: SqlReview, action: "accept" | "abandon") => Promise<void>;
}) {
  return (
    <div className="space-y-3">
      {reviews.map((review) => (
        <section
          key={review.interruptId}
          aria-label="SQL decision"
          className="space-y-3 rounded-lg border border-line bg-surface p-4"
        >
          <p className="text-sm/6 text-muted">
            {reviews.length === 1
              ? "Continue the discussion below, accept this version, or abandon it."
              : "Multiple SQL reviews are pending. Decide on each workflow before continuing the discussion."}
          </p>
          {!review.check.passed && (
            <p className="text-xs/5 text-muted">
              SQL must pass its check before submission.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={running || !review.check.passed}
              onClick={() => void onReview(review, "accept")}
            >
              Accept and submit
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
