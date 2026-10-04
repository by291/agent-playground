import type { Interrupt, ResumeEntry } from "@ag-ui/client";
import { LangGraphAgent } from "@ag-ui/langgraph";
import { sqlReviewResponseSchema } from "../../shared/sql-review";
export class ReviewLangGraphAgent extends LangGraphAgent {
  protected override buildCommandResumeFromAgui(
    entries: readonly ResumeEntry[],
    context: { openInterrupts: Interrupt[] },
  ): unknown {
    const sqlReview = entries.some(
      (entry) => sqlReviewResponseSchema.safeParse(entry.payload).success,
    );

    if (
      entries.length <= 1 &&
      !sqlReview &&
      context.openInterrupts.length <= 1
    ) {
      return super.buildCommandResumeFromAgui(entries, context);
    }

    return Object.fromEntries(
      entries.map((entry) => [
        entry.interruptId,
        super.buildCommandResumeFromAgui([entry], context),
      ]),
    );
  }
}
