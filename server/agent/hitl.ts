import type { Interrupt, ResumeEntry } from "@ag-ui/client";
import { LangGraphAgent } from "@ag-ui/langgraph";
import { workflowReviewResponseSchema } from "../../shared/workflow-review";
export class ReviewLangGraphAgent extends LangGraphAgent {
  protected override buildCommandResumeFromAgui(
    entries: readonly ResumeEntry[],
    context: { openInterrupts: Interrupt[] },
  ): unknown {
    const workflowReview = entries.some(
      (entry) => workflowReviewResponseSchema.safeParse(entry.payload).success,
    );

    if (
      entries.length <= 1 &&
      !workflowReview &&
      context.openInterrupts.length <= 1
    ) {
      return super.buildCommandResumeFromAgui(entries, context);
    }

    // The official adapter maps a single response to its sentinel/payload value.
    // Workflow review resumes need that value keyed by the original interrupt ID.
    return Object.fromEntries(
      entries.map((entry) => [
        entry.interruptId,
        super.buildCommandResumeFromAgui([entry], context),
      ]),
    );
  }
}
