import type { Interrupt, ResumeEntry } from "@ag-ui/client";
import { LangGraphAgent } from "@ag-ui/langgraph";

export class ReviewLangGraphAgent extends LangGraphAgent {
  protected override buildCommandResumeFromAgui(
    entries: readonly ResumeEntry[],
    context: { openInterrupts: Interrupt[] },
  ): unknown {
    if (entries.length <= 1)
      return super.buildCommandResumeFromAgui(entries, context);

    return Object.fromEntries(
      entries.map((entry) => [
        entry.interruptId,
        super.buildCommandResumeFromAgui([entry], context),
      ]),
    );
  }
}
