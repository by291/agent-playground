import { useState, type SubmitEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
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
            <NativeSelect
              value={draft.decision}
              onChange={(event) =>
                update(index, {
                  decision: event.target.value as "approve" | "reject",
                })
              }
              disabled={running}
              className="mt-1 w-full [&_select]:h-10 [&_select]:bg-white"
            >
              <NativeSelectOption value="approve">Approve</NativeSelectOption>
              <NativeSelectOption value="reject">Reject</NativeSelectOption>
            </NativeSelect>
          </label>
          <label className="block text-xs font-medium text-ink">
            Title
            <Input
              value={draft.title}
              onChange={(event) => update(index, { title: event.target.value })}
              disabled={running || draft.decision === "reject"}
              className="mt-1 h-10 bg-white"
            />
          </label>
          <label className="block text-xs font-medium text-ink">
            Steps, one per line
            <Textarea
              value={draft.stepsText}
              onChange={(event) =>
                update(index, { stepsText: event.target.value })
              }
              disabled={running || draft.decision === "reject"}
              rows={Math.max(3, draft.stepsText.split("\n").length)}
              className="mt-1 resize-y bg-white"
            />
          </label>
        </fieldset>
      ))}
      <Button
        type="submit"
        disabled={running || invalid}
        className="h-10 rounded-xl px-4"
      >
        {running ? "Continuing…" : "Submit review"}
      </Button>
    </form>
  );
}
