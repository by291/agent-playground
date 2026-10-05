import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  FieldDescription,
  FieldError,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import type { WorkflowReview } from "@shared/workflow-review";
import { AnimatePresence } from "motion/react";
import { AnimatedDiv } from "@/components/ui/motion";

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
      <AnimatePresence initial={false}>
        {reviews.map((review) => (
          <AnimatedDiv
            key={review.interruptId}
            exit={{ opacity: 0, height: 0, overflow: "hidden" }}
          >
            <section aria-label={review.title}>
              <Card className="gap-0 py-4">
                <CardContent>
                  <FieldSet disabled={running} className="gap-3">
                    <FieldLegend className="sr-only">
                      {review.title}
                    </FieldLegend>
                    <FieldDescription
                      key={review.canAccept ? "accept" : "blocked"}
                      className="motion-content-enter text-sm/6 text-muted"
                    >
                      {reviews.length === 1
                        ? "Continue the discussion below, accept this version, or abandon it."
                        : "Multiple workflow reviews are pending. Decide on each workflow before continuing the discussion."}
                    </FieldDescription>
                    {!review.canAccept && (
                      <FieldError className="text-xs/5">
                        {review.blockedReason ??
                          "This version cannot be accepted yet."}
                      </FieldError>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={running || !review.canAccept}
                        onClick={() => void onReview(review, "accept")}
                      >
                        {running && <Spinner aria-hidden="true" />}
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
                  </FieldSet>
                </CardContent>
              </Card>
            </section>
          </AnimatedDiv>
        ))}
      </AnimatePresence>
    </div>
  );
}
