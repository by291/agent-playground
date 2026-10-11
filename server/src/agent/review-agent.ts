import type { Interrupt, ResumeEntry } from "@ag-ui/client";
import {
  LangGraphAgent,
  LangGraphEventTypes,
  type LangGraphAgentConfig,
} from "@ag-ui/langgraph";
import { z } from "zod";
import { workflowReviewResponseSchema } from "../../../shared/workflow-review.js";

const toolResultSchema = z.object({
  type: z.literal("tool"),
  tool_call_id: z.string().min(1),
});
const commandResultSchema = z.object({
  update: z.object({ messages: z.array(z.unknown()) }),
});
const toolEndEventSchema = z.object({
  event: z.literal(LangGraphEventTypes.OnToolEnd),
  data: z.object({ output: z.unknown() }),
});

export class ReviewLangGraphAgent extends LangGraphAgent {
  constructor(
    config: LangGraphAgentConfig,
    private readonly onProducerSettled?: () => Promise<void>,
  ) {
    super(config);
  }

  override async getSchemaKeys() {
    const schema = await super.getSchemaKeys();

    if (!schema) {
      return schema;
    }

    // The Aegra graph factory selects the model before the compiled graph runs,
    // so this server-owned field is absent from the graph's configuration schema.
    return { ...schema, config: [...(schema.config ?? []), "model_id"] };
  }

  override handleSingleEvent(event: unknown): void {
    const toolEnd = toolEndEventSchema.safeParse(event);

    if (toolEnd.success) {
      const output = toolEnd.data.data.output;
      const command = commandResultSchema.safeParse(output);
      const results = command.success ? command.data.update.messages : [output];
      const hasToolResult = results.some(
        (result) => toolResultSchema.safeParse(result).success,
      );

      // Nested tool invocations (e.g. LangMem) return internal values without a
      // model tool-call ID. The adapter assumes every on_tool_end is a public
      // ToolMessage and otherwise emits invalid AG-UI lifecycle events.
      if (!hasToolResult) {
        return;
      }
    }

    super.handleSingleEvent(event);
  }

  override async runAgentStream(
    ...args: Parameters<LangGraphAgent["runAgentStream"]>
  ): Promise<void> {
    try {
      await super.runAgentStream(...args);
    } finally {
      // The SDK producer can outlive an unsubscribed HTTP consumer.
      await this.onProducerSettled?.();
    }
  }

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
