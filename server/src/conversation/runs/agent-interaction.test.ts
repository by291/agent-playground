import { expect, test } from "vitest";
import { InterruptSchema } from "../../../../shared/ag-ui-schemas.js";
import {
  interactionResponse,
  parseAgentInteraction,
  userQuestionsSchema,
} from "../../../../shared/agent-interaction.js";

const interrupt = InterruptSchema.parse({
  id: "human-gate",
  reason: "Input required",
  metadata: {
    langgraph: {
      raw: {
        action_requests: [
          {
            name: "run_skill_script",
            args: { script_path: "scripts/export.py" },
          },
          {
            name: "ask_user",
            args: {
              questions: [
                {
                  id: "audience",
                  question: "Who will read the report?",
                  options: [{ label: "Engineering" }, { label: "Leadership" }],
                },
              ],
            },
          },
        ],
        review_configs: [
          {
            action_name: "run_skill_script",
            allowed_decisions: ["approve", "reject"],
          },
          { action_name: "ask_user", allowed_decisions: ["respond", "reject"] },
        ],
      },
    },
  },
});

test("a mixed approval and clarification batch requires every decision in order", () => {
  const interaction = parseAgentInteraction(interrupt)!;
  const payload = {
    decisions: [
      { type: "approve" },
      {
        type: "respond",
        message: JSON.stringify({
          answers: [{ id: "audience", answer: "Operations" }],
        }),
      },
    ],
  };

  expect(interactionResponse(interaction, payload)).toEqual({
    interruptId: "human-gate",
    status: "resolved",
    payload,
  });
  expect(
    interactionResponse(interaction, { decisions: payload.decisions.slice(1) }),
  ).toBeNull();
  expect(
    interactionResponse(interaction, {
      decisions: [...payload.decisions].reverse(),
    }),
  ).toBeNull();
});

test("responses cannot replace tool names, grant permissions, or answer different questions", () => {
  const interaction = parseAgentInteraction(interrupt)!;

  for (const decisions of [
    [
      { type: "edit", edited_action: { name: "delete_everything", args: {} } },
      { type: "reject" },
    ],
    [{ type: "approve", scope: "session" }, { type: "reject" }],
    [{ type: "approve" }, { type: "respond", message: "not JSON" }],
    [
      { type: "approve" },
      {
        type: "respond",
        message: JSON.stringify({
          answers: [{ id: "old-question", answer: "Yes" }],
        }),
      },
    ],
    [
      { type: "approve" },
      {
        type: "respond",
        message: JSON.stringify({
          answers: [{ id: "audience", answer: "   " }],
        }),
      },
    ],
  ]) {
    expect(interactionResponse(interaction, { decisions })).toBeNull();
  }
});

test("malformed question batches and mismatched action configs are not interactive forms", () => {
  const raw = structuredClone(parseAgentInteraction(interrupt)!);

  raw.review_configs[0]!.action_name = "different_tool";
  expect(
    parseAgentInteraction({ ...interrupt, metadata: { langgraph: { raw } } }),
  ).toBeNull();

  const duplicateQuestions = structuredClone(parseAgentInteraction(interrupt)!);
  const action = duplicateQuestions.action_requests[1]!;
  const { questions } = userQuestionsSchema.parse(action.args);

  questions.push(questions[0]!);
  action.args = { questions };
  expect(
    parseAgentInteraction({
      ...interrupt,
      metadata: { langgraph: { raw: duplicateQuestions } },
    }),
  ).toBeNull();
});

test("answer limits validate original text and allow JSON escaping within three valid answers", () => {
  const interaction = structuredClone(parseAgentInteraction(interrupt)!);
  const questions = ["first", "second", "third"].map((id) => ({
    id,
    question: `Answer ${id}`,
  }));

  interaction.action_requests[1]!.args = { questions };
  const message = JSON.stringify({
    answers: questions.map(({ id }) => ({
      id,
      answer: `${"\n".repeat(3999)}x`,
    })),
  });

  expect(
    interactionResponse(interaction, {
      decisions: [{ type: "approve" }, { type: "respond", message }],
    }),
  ).not.toBeNull();
  expect(
    interactionResponse(interaction, {
      decisions: [
        { type: "approve" },
        {
          type: "respond",
          message: JSON.stringify({
            answers: questions.map(({ id }) => ({
              id,
              answer: `${" ".repeat(4000)}x`,
            })),
          }),
        },
      ],
    }),
  ).toBeNull();
});
