import { useState, type SubmitEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PlanReview, PlanReviewResponse } from "../../model/planReview";
import { AnimatePresence } from "motion/react";
import { AnimatedDiv } from "@/components/ui/motion";

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
      <AnimatePresence initial={false}>
        {drafts.map((draft, index) => {
          // A parallel plan may finish while its siblings are still applying.
          // Keep their local edits and batch decisions until the batch changes.
          if (!visibleReviews.has(draft.interruptId)) {
            return null;
          }

          return (
            <AnimatedDiv
              key={draft.interruptId}
              exit={{ opacity: 0, height: 0, overflow: "hidden" }}
            >
              <fieldset className="min-w-0 space-y-4 overflow-hidden rounded-lg border border-line bg-surface p-4 sm:p-5">
                <legend className="sr-only">Review plan {index + 1}</legend>
                <div className="-mx-4 -mt-4 border-b border-line bg-sidebar px-4 py-3 sm:-mx-5 sm:-mt-5 sm:px-5">
                  <p className="text-xs font-medium text-amber-800">
                    {running ? "Applying review" : "Review required"}
                  </p>
                  <p className="mt-1 text-xs/5 text-muted">
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
                    className="mt-1 h-11 bg-surface"
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
                    className="mt-1 resize-y bg-surface"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type={multiple ? "button" : "submit"}
                    disabled={running || !validPlan(draft)}
                    aria-pressed={
                      multiple ? draft.decision === "approve" : undefined
                    }
                    onClick={
                      multiple ? () => choose(index, "approve") : undefined
                    }
                    className="h-10 rounded-md px-4"
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
                    className="h-10 rounded-md bg-surface px-4"
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
            </AnimatedDiv>
          );
        })}
      </AnimatePresence>
      {multiple && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            Choose a decision for every plan before continuing.
          </p>
          <Button
            type="submit"
            disabled={running || incomplete}
            className="h-10 rounded-md px-4"
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
