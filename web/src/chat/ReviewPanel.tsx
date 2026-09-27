import { useState, type SubmitEvent } from "react";
import type { ChatPaneProps } from "./types";

interface ReviewDraft {
  interruptId: string;
  decision: "approve" | "reject";
  title: string;
  stepsText: string;
}

export function ReviewPanel({
  reviews,
  running,
  onReview,
}: Pick<ChatPaneProps, "reviews" | "running" | "onReview">) {
  const [drafts, setDrafts] = useState<ReviewDraft[]>(() =>
    reviews.map((review) => ({
      interruptId: review.interruptId,
      decision: "approve",
      title: review.title,
      stepsText: review.steps.join("\n"),
    })),
  );

  function update(index: number, changes: Partial<(typeof drafts)[number]>) {
    setDrafts((current) =>
      current.map((draft, itemIndex) =>
        itemIndex === index ? { ...draft, ...changes } : draft,
      ),
    );
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const responses = drafts.map((draft) => ({
      interruptId: draft.interruptId,
      decision: draft.decision,
      title: draft.title.trim(),
      steps: draft.stepsText
        .split("\n")
        .map((step) => step.trim())
        .filter(Boolean),
    }));
    void onReview(responses);
  }

  const invalid = drafts.some(
    (draft) =>
      draft.decision === "approve" &&
      (!draft.title.trim() || !draft.stepsText.trim()),
  );

  return (
    <form
      onSubmit={submit}
      className="ml-11 space-y-5 rounded-2xl border border-accent-line bg-accent-soft/40 p-4 sm:ml-12"
    >
      <div>
        <h2 className="text-sm font-semibold text-ink">
          Review experiment plan
        </h2>
        <p className="mt-1 text-xs text-muted">
          Edit the draft, then approve or reject it to continue the workflow.
        </p>
      </div>
      {drafts.map((draft, index) => (
        <fieldset key={draft.interruptId} className="space-y-3">
          {drafts.length > 1 && (
            <legend className="text-xs font-semibold text-ink">
              Plan {index + 1}
            </legend>
          )}
          <label className="block text-xs font-medium text-ink">
            Decision
            <select
              value={draft.decision}
              onChange={(event) =>
                update(index, {
                  decision: event.target.value as "approve" | "reject",
                })
              }
              disabled={running}
              className="mt-1 block w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
            >
              <option value="approve">Approve</option>
              <option value="reject">Reject</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-ink">
            Title
            <input
              value={draft.title}
              onChange={(event) => update(index, { title: event.target.value })}
              disabled={running || draft.decision === "reject"}
              className="mt-1 block w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
            />
          </label>
          <label className="block text-xs font-medium text-ink">
            Steps, one per line
            <textarea
              value={draft.stepsText}
              onChange={(event) =>
                update(index, { stepsText: event.target.value })
              }
              disabled={running || draft.decision === "reject"}
              rows={Math.max(3, draft.stepsText.split("\n").length)}
              className="mt-1 block w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
            />
          </label>
        </fieldset>
      ))}
      <button
        type="submit"
        disabled={running || invalid}
        className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-soft"
      >
        {running ? "Continuing…" : "Submit review"}
      </button>
    </form>
  );
}
