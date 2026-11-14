import { EventType, type Interrupt, type ResumeEntry } from "@ag-ui/client";
import {
  LangGraphAgent,
  LangGraphEventTypes,
  type LangGraphAgentConfig,
} from "@ag-ui/langgraph";
import { z } from "zod";
import { workflowReviewResponseSchema } from "../../../shared/workflow-review.js";
import { completedMessages } from "./checkpoint-messages.js";

const interactionNodeName = "InteractionMiddleware.after_model";

const toolResultSchema = z
  .object({
    type: z.literal("tool"),
    tool_call_id: z.string().min(1),
  })
  .passthrough();
const commandResultSchema = z
  .object({
    update: z.object({ messages: z.array(z.unknown()) }).passthrough(),
  })
  .passthrough();
const toolEndEventSchema = z
  .object({
    event: z.literal(LangGraphEventTypes.OnToolEnd),
    name: z.string().min(1).optional(),
    data: z.object({ output: z.unknown() }).passthrough(),
  })
  .passthrough();
const interactionEndEventSchema = z.object({
  event: z.literal(LangGraphEventTypes.OnChainEnd),
  name: z.literal(interactionNodeName),
  metadata: z.object({
    langgraph_node: z.literal(interactionNodeName),
  }),
  data: z.object({ output: z.object({ messages: z.array(z.unknown()) }) }),
});

type ToolEndEvent = z.infer<typeof toolEndEventSchema>;

function adaptToolEndEvent(
  event: ToolEndEvent,
  originalEvent: unknown,
): unknown {
  const output = event.data.output;
  const command = commandResultSchema.safeParse(output);
  const results = command.success ? command.data.update.messages : [output];
  const hasToolResult = results.some(
    (result) => toolResultSchema.safeParse(result).success,
  );

  // Nested tools can return internal values without a public tool-call ID.
  // The SDK would turn those values into invalid AG-UI lifecycle events.
  if (!hasToolResult) {
    return undefined;
  }

  const toolName = event.name;

  if (!toolName) {
    return originalEvent;
  }

  // The SDK re-announces tool calls during approval replay and needs a name.
  const namedResults = results.map((result) => {
    const message = toolResultSchema.safeParse(result);

    if (!message.success || typeof message.data.name === "string") {
      return result;
    }

    return { ...message.data, name: toolName };
  });
  const namedOutput = command.success
    ? {
        ...command.data,
        update: { ...command.data.update, messages: namedResults },
      }
    : namedResults[0];

  return {
    ...event,
    data: { ...event.data, output: namedOutput },
  };
}

/** Adapts Aegra interaction receipts, tool events, and stream completion. */
export class ReviewLangGraphAgent extends LangGraphAgent {
  private interactionRunId: string | undefined;
  private readonly interactionResults = new Set<string>();

  constructor(
    config: LangGraphAgentConfig,
    private readonly onProducerSettled?: () => Promise<void>,
  ) {
    super(config);
  }

  /** Includes server-owned configuration used by the per-run graph factory. */
  override async getSchemaKeys() {
    const schema = await super.getSchemaKeys();

    if (!schema) {
      return schema;
    }

    // The Aegra graph factory selects the model before the compiled graph runs,
    // so this server-owned field is absent from the graph's configuration schema.
    return { ...schema, config: [...(schema.config ?? []), "model_id"] };
  }

  private publishInteractionResults(event: unknown): void {
    const interactionEnd = interactionEndEventSchema.safeParse(event);

    if (!interactionEnd.success || !this.activeRun) {
      return;
    }

    if (this.interactionRunId !== this.activeRun.id) {
      this.interactionRunId = this.activeRun.id;
      this.interactionResults.clear();
    }

    // Native HITL responses are committed by after_model without executing a
    // tool. Publish their real receipts before the next model starts streaming.
    for (const message of completedMessages(interactionEnd.data.data.output)) {
      if (
        message.role !== "tool" ||
        message.error !== undefined ||
        this.interactionResults.has(message.toolCallId)
      ) {
        continue;
      }

      this.interactionResults.add(message.toolCallId);
      this.dispatchEvent({
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: message.toolCallId,
        messageId: message.id,
        role: "tool",
        content: message.content,
      });
    }
  }

  /** Converts Aegra-specific tool and interaction events before SDK forwarding. */
  override handleSingleEvent(event: unknown): void {
    this.publishInteractionResults(event);

    const toolEnd = toolEndEventSchema.safeParse(event);

    if (!toolEnd.success) {
      super.handleSingleEvent(event);

      return;
    }

    const adaptedEvent = adaptToolEndEvent(toolEnd.data, event);

    if (adaptedEvent !== undefined) {
      super.handleSingleEvent(adaptedEvent);
    }
  }

  /** Waits for server bookkeeping when the upstream SDK producer exits. */
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
    const hasWorkflowReview = entries.some(
      (entry) => workflowReviewResponseSchema.safeParse(entry.payload).success,
    );
    const usesScalarResume =
      entries.length <= 1 &&
      !hasWorkflowReview &&
      context.openInterrupts.length <= 1;

    if (usesScalarResume) {
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
