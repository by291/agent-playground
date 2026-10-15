import type { ResumeEntry } from "@ag-ui/core";
import { z } from "zod";

const questionSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .refine((value) => Boolean(value.trim())),
  question: z
    .string()
    .min(1)
    .max(1000)
    .refine((value) => Boolean(value.trim())),
  options: z
    .array(
      z.object({
        label: z
          .string()
          .min(1)
          .max(200)
          .refine((value) => Boolean(value.trim())),
        description: z.string().max(500).optional(),
      }),
    )
    .min(2)
    .max(4)
    .refine(
      (options) =>
        new Set(options.map((option) => option.label)).size === options.length,
    )
    .optional(),
});

export const userQuestionsSchema = z
  .object({
    questions: z.array(questionSchema).min(1).max(3),
  })
  .refine(
    ({ questions }) =>
      new Set(questions.map((question) => question.id)).size ===
      questions.length,
  );

const decisionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approve") }).strict(),
  z
    .object({
      type: z.literal("reject"),
      message: z.string().max(4000).optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("respond"), message: z.string().max(80000) })
    .strict(),
]);

const responseSchema = z
  .object({ decisions: z.array(decisionSchema).min(1) })
  .strict();
export const userAnswersSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            id: z.string(),
            answer: z
              .string()
              .min(1)
              .max(4000)
              .refine((value) => Boolean(value.trim())),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();

// This is LangChain's HITLRequest wire shape, carried by the official AG-UI interrupt.
const requestSchema = z
  .object({
    action_requests: z
      .array(
        z.object({
          name: z.string().min(1),
          args: z.record(z.unknown()),
          description: z.string().optional(),
        }),
      )
      .min(1),
    review_configs: z
      .array(
        z.object({
          action_name: z.string().min(1),
          allowed_decisions: z
            .array(z.enum(["approve", "reject", "respond"]))
            .min(1)
            .refine((values) => new Set(values).size === values.length),
        }),
      )
      .min(1),
  })
  .superRefine((request, context) => {
    if (request.action_requests.length !== request.review_configs.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Mismatched action configuration",
      });
    }

    request.action_requests.forEach((action, index) => {
      const config = request.review_configs[index];
      const askingUser = action.name === "ask_user";
      const invalidDecisions = config?.allowed_decisions.some((decision) =>
        askingUser ? decision === "approve" : decision === "respond",
      );

      if (
        config?.action_name !== action.name ||
        invalidDecisions ||
        (askingUser && !userQuestionsSchema.safeParse(action.args).success)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid interaction action",
        });
      }
    });
  });

export type UserQuestion = z.infer<typeof questionSchema>;
export type InteractionDecision = z.infer<typeof decisionSchema>;
export type InteractionResponse = z.infer<typeof responseSchema>;
export type AgentInteraction = z.infer<typeof requestSchema> & {
  interruptId: string;
};

export function parseAgentInteraction(interrupt: {
  id: string;
  metadata?: unknown;
}): AgentInteraction | null {
  const metadata = z
    .object({ langgraph: z.object({ raw: requestSchema }) })
    .safeParse(interrupt.metadata);

  return metadata.success
    ? { ...metadata.data.langgraph.raw, interruptId: interrupt.id }
    : null;
}

/** Validates the complete native HITL batch; answers and approvals share one checkpoint. */
export function interactionResponse(
  interaction: AgentInteraction,
  payload: unknown,
): ResumeEntry | null {
  const parsed = responseSchema.safeParse(payload);

  if (
    !parsed.success ||
    parsed.data.decisions.length !== interaction.action_requests.length
  ) {
    return null;
  }

  for (const [index, decision] of parsed.data.decisions.entries()) {
    const action = interaction.action_requests[index]!;
    const config = interaction.review_configs[index]!;

    if (!config.allowed_decisions.includes(decision.type)) {
      return null;
    }

    if (decision.type === "respond") {
      let message: unknown;

      try {
        message = JSON.parse(decision.message);
      } catch {
        return null;
      }

      const questions = userQuestionsSchema.safeParse(action.args);
      const answers = userAnswersSchema.safeParse(message);

      if (
        !questions.success ||
        !answers.success ||
        answers.data.answers.length !== questions.data.questions.length
      ) {
        return null;
      }

      const exactQuestions = questions.data.questions.every(
        (question, questionIndex) =>
          answers.data.answers[questionIndex]?.id === question.id,
      );

      if (!exactQuestions) {
        return null;
      }
    }
  }

  return {
    interruptId: interaction.interruptId,
    status: "resolved",
    payload: parsed.data,
  };
}
