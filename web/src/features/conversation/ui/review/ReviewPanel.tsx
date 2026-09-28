import { useState, type SubmitEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PlanReview, PlanReviewResponse } from "../../model/planReview";

interface ReviewDraft {
  interruptId: string;
  decision: "approve" | "reject" | null;
  title: string;
  stepsText: string;
}

function validPlan(draft: ReviewDraft) {
  return Boolean(draft.title.trim() && draft.stepsText.trim());
}

export function ReviewPanel({
  reviews,
  running,
  onReview,
}: {
  reviews: PlanReview[];
  running: boolean;
  onReview: (responses: PlanReviewResponse[]) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<ReviewDraft[]>(() =>
    reviews.map((review) => ({
      interruptId: review.interruptId,
      decision: null,
      title: review.title,
      stepsText: review.steps.join("\n"),
    })),
  );
  const multiple = drafts.length > 1;
  const visibleReviews = new Set(reviews.map((review) => review.interruptId));

  function update(index: number, changes: Partial<ReviewDraft>) {
    setDrafts((current) =>
      current.map((draft, itemIndex) =>
        itemIndex === index ? { ...draft, ...changes } : draft,
      ),
    );
  }

  function send(decisions: ReviewDraft[]) {
    if (
      running ||
      decisions.some(
        (draft) =>
          !draft.decision ||
          (draft.decision === "approve" && !validPlan(draft)),
      )
    ) {
      return;
    }

    const responses: PlanReviewResponse[] = decisions.map((draft) => ({
      interruptId: draft.interruptId,
      decision: draft.decision!,
      title: draft.title.trim(),
      steps: draft.stepsText
        .split("\n")
        .map((step) => step.trim())
        .filter(Boolean),
    }));

    void onReview(responses);
  }

  function choose(index: number, decision: "approve" | "reject") {
    if (multiple) {
      update(index, { decision });
    } else {
      send(drafts.map((draft) => ({ ...draft, decision })));
    }
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (multiple) {
      send(drafts);
    } else {
      choose(0, "approve");
    }
  }

  const incomplete = drafts.some(
    (draft) =>
      !draft.decision || (draft.decision === "approve" && !validPlan(draft)),
  );

  return (
    <form onSubmit={submit} className="space-y-3">
      {drafts.map((draft, index) => {
        // A parallel plan may finish while its siblings are still applying.
        // Keep their local edits and batch decisions until the batch changes.
        if (!visibleReviews.has(draft.interruptId)) {
          return null;
        }

        return (
          <fieldset
            key={draft.interruptId}
            className="review-panel-enter min-w-0 space-y-4 rounded-2xl border border-accent-line bg-accent-soft/40 p-4 shadow-sm sm:p-5"
          >
            <legend className="sr-only">Review plan {index + 1}</legend>
            <div>
              <p className="text-[11px] font-semibold tracking-[0.14em] text-accent uppercase">
                {running ? "Applying review" : "Review required"}
              </p>
              <p className="mt-2 text-sm text-muted">
                Edit the plan below, then approve or reject it.
              </p>
            </div>
            <label className="block text-xs font-medium text-ink">
              Title
              <Input
                value={draft.title}
                onChange={(event) =>
                  update(index, { title: event.target.value })
                }
                disabled={running}
                className="mt-1 h-11 bg-white"
              />
            </label>
            <label className="block text-xs font-medium text-ink">
              Steps, one per line
              <Textarea
                value={draft.stepsText}
                onChange={(event) =>
                  update(index, { stepsText: event.target.value })
                }
                disabled={running}
                rows={Math.min(
                  8,
                  Math.max(3, draft.stepsText.split("\n").length),
                )}
                className="mt-1 resize-y bg-white"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type={multiple ? "button" : "submit"}
                disabled={running || !validPlan(draft)}
                aria-pressed={
                  multiple ? draft.decision === "approve" : undefined
                }
                onClick={multiple ? () => choose(index, "approve") : undefined}
                className="h-11 rounded-xl px-4"
              >
                Approve plan
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={running}
                aria-pressed={
                  multiple ? draft.decision === "reject" : undefined
                }
                onClick={() => choose(index, "reject")}
                className="h-11 rounded-xl bg-white px-4"
              >
                Reject
              </Button>
            </div>
            {multiple && draft.decision && (
              <p role="status" className="text-xs text-muted">
                {draft.decision === "approve"
                  ? "Approval selected"
                  : "Rejection selected"}
              </p>
            )}
          </fieldset>
        );
      })}
      {multiple && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            Choose a decision for every plan before continuing.
          </p>
          <Button
            type="submit"
            disabled={running || incomplete}
            className="h-11 rounded-xl px-4"
          >
            {running ? "Continuing…" : "Continue workflow"}
          </Button>
        </div>
      )}
      {running && (
        <p role="status" className="text-xs text-muted">
          Continuing workflow…
        </p>
      )}
    </form>
  );
}
