import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { HumanMessage } from "@langchain/langgraph-sdk";
import {
  LangGraphEventTypes,
  type LangGraphPlatformMessage,
} from "@ag-ui/langgraph";
import type { db } from "../../src/db/database.js";
import { ControlledSqlWorkflow } from "./sql-workflow.js";
import {
  workflowReviewResponseSchema,
  type WorkflowReview,
} from "../../../shared/workflow-review.js";
import type { WorkflowOutputMetadata } from "../../../shared/workflow-output.js";
import {
  parseAgentInteraction,
  interactionResponse,
  type AgentInteraction,
} from "../../../shared/agent-interaction.js";

const resumeSchema = z.object({
  decision: z.literal("approve"),
  title: z.string(),
  steps: z.string().array(),
});
const requestSchema = z.object({
  input: z
    .object({
      messages: z.array(
        z.object({
          id: z.string(),
          content: z.union([
            z.string(),
            z.array(
              z.discriminatedUnion("type", [
                z.object({ type: z.literal("text"), text: z.string() }),
                z.object({
                  type: z.literal("image_url"),
                  image_url: z.object({ url: z.string() }),
                }),
              ]),
            ),
          ]),
        }),
      ),
    })
    .optional(),
  command: z.object({ resume: z.unknown() }).optional(),
  config: z
    .object({
      configurable: z.object({ model_id: z.string().optional() }).optional(),
    })
    .optional(),
  metadata: z.object({ agui_run_id: z.string() }),
});

interface Thread {
  messages: (LangGraphPlatformMessage | HumanMessage)[];
  review: {
    id: string;
    value:
      | {
          kind: "workflow_external_wait";
          taskId: string;
          workflowCallId: string;
        }
      | Omit<WorkflowReview, "interruptId">
      | (Omit<AgentInteraction, "interruptId"> & {
          kind?: never;
          workflowCallId?: never;
        })
      | {
          kind: string;
          workflowCallId: string;
          title: string;
          steps: string[];
        };
  } | null;
  runs: {
    run_id: string;
    thread_id: string;
    status: string;
    config: { metadata: { agui_run_id: string } };
  }[];
  release?: () => void;
  sql?: ControlledSqlWorkflow;
  externalWorkflow?: "report" | "a2a";
  interactionCall?: { callId: string; name: string };
  holdInteractionReply?: boolean;
  followupApproval?: boolean;
}

// Only the Aegra HTTP boundary is controlled. The browser, adapter, server and
// PostgreSQL use the real application code and do not intercept frontend traffic.
export function controlledAegra(database: typeof db) {
  const api = new Hono();
  const threads = new Map<string, Thread>();

  api.get("/agent-info", (context) =>
    context.json({
      model: "test-model",
      defaultModelId: "deepseek",
      models: [
        {
          id: "deepseek",
          label: "DeepSeek",
          model: "test-model",
          available: true,
        },
        { id: "qwen", label: "Qwen", model: "test-qwen", available: true },
      ],
    }),
  );

  function threadFor(id: string) {
    let thread = threads.get(id);

    if (!thread) {
      thread = { messages: [], review: null, runs: [] };
      threads.set(id, thread);
    }

    return thread;
  }

  function stateFor(id: string) {
    const thread = threadFor(id);

    return {
      values: { messages: thread.messages },
      tasks: thread.review
        ? [{ id: "review-task", name: "tools", interrupts: [thread.review] }]
        : [],
      next: thread.review ? ["tools"] : [],
      checkpoint: {
        thread_id: id,
        checkpoint_id: "fixture-checkpoint",
        checkpoint_ns: "",
      },
      metadata: {},
      created_at: null,
      parent_checkpoint: null,
    };
  }

  async function publishCard(
    threadId: string,
    runId: string,
    callId: string,
    stage: "review" | "reviewed",
    title: string,
    steps: string[],
    presentation?: WorkflowOutputMetadata["presentation"],
  ) {
    const surfaceId =
      presentation?.surfaceId ?? `experiment-${callId}-${stage}`;
    const payload = {
      ...(presentation ? { workflow: { presentation } } : {}),
      messages: [
        {
          version: "v0.9",
          createSurface: {
            surfaceId,
            catalogId: "urn:agent-playground:workflow:v1",
          },
        },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId,
            components: [
              {
                id: "root",
                component: "WorkflowPanel",
                children: ["title", "steps"],
              },
              {
                id: "title",
                component: "WorkflowText",
                role: "title",
                text: title,
              },
              {
                id: "steps",
                component: "WorkflowText",
                role: "body",
                text: steps.join("\n"),
              },
            ],
          },
        },
      ],
    };
    const id = randomUUID();
    const outputSeq = await database.transaction(async (tx) => {
      const result = await tx.execute<{ output_seq: string }>(sql`
        UPDATE conversations SET next_output_seq = next_output_seq + 1
        WHERE thread_id = ${threadId} RETURNING next_output_seq - 1 AS output_seq
      `);
      const sequence = Number(result.rows[0]!.output_seq);

      await tx.execute(sql`
        INSERT INTO workflow_outputs
          (id, thread_id, agui_run_id, workflow_call_id, step_id, step_seq, output_seq, kind, version, payload)
        VALUES (${id}, ${threadId}, ${runId}, ${callId}, ${stage}, ${stage === "review" ? 3 : 4}, ${sequence}, 'a2ui', 1, ${JSON.stringify(payload)}::jsonb)
      `);

      return sequence;
    });

    return {
      id,
      aguiRunId: runId,
      workflowCallId: callId,
      toolCallId: callId,
      outputSeq,
      ...payload,
    };
  }

  api.post("/assistants/search", (context) =>
    context.json([{ assistant_id: "agent", graph_id: "agent", config: {} }]),
  );
  api.get("/assistants/agent/schemas", (context) => context.json({}));
  api.get("/assistants/agent/graph", (context) =>
    context.json({ nodes: [{ id: "agent" }, { id: "tools" }], edges: [] }),
  );
  api.get("/threads/:id", (context) =>
    context.json({ thread_id: context.req.param("id"), metadata: {} }),
  );
  api.get("/threads/:id/state", (context) =>
    context.json(stateFor(context.req.param("id"))),
  );
  api.get("/threads/:id/runs", (context) =>
    context.json(threadFor(context.req.param("id")).runs.slice(-1)),
  );
  api.get("/threads/:id/runs/:runId", (context) => {
    const run = threadFor(context.req.param("id")).runs.find(
      (row) => row.run_id === context.req.param("runId"),
    );

    return run
      ? context.json(run)
      : context.json({ error: "Run not found" }, 404);
  });
  api.post("/threads/:id/runs", async (context) => {
    const input = requestSchema.parse(await context.req.json());
    const threadId = context.req.param("id");
    const thread = threadFor(threadId);
    const wait = thread.review;

    if (wait?.value.kind !== "workflow_external_wait") {
      return context.json({ error: "No external wait" }, 409);
    }

    const command = z.record(z.unknown()).parse(input.command?.resume);
    const result = z
      .object({
        kind: z.literal("external_task_result"),
        taskId: z.string(),
        status: z.enum(["succeeded", "failed", "cancelled"]),
        result: z.record(z.unknown()).optional(),
        error: z.string().optional(),
      })
      .parse(command[wait.id]);
    const workflow = thread.externalWorkflow ?? "report";
    const replies = {
      report: {
        succeeded: "The report is ready.",
        failed: "Report generation failed.",
        cancelled: "Report generation cancelled.",
      },
      a2a: {
        succeeded: "The A2A collaboration is ready.",
        failed: "A2A collaboration failed.",
        cancelled: "The A2A collaboration was cancelled.",
      },
    };
    const titles = {
      succeeded: "A2A collaboration completed",
      failed: "A2A collaboration failed",
      cancelled: "A2A collaboration cancelled",
    };
    let lines = ["The external service produced the report."];

    if (workflow === "a2a") {
      let receipt = result.error ?? "The agent collaboration failed.";

      if (result.status === "succeeded") {
        receipt = "The full revision is available in the agent output.";
      } else if (result.status === "cancelled") {
        receipt = "The agent collaboration was cancelled.";
      }

      lines = [receipt];
    }

    const run = {
      run_id: randomUUID(),
      thread_id: threadId,
      status: "success",
      config: { metadata: input.metadata },
    };

    thread.runs.push(run);
    thread.messages.push({
      id: randomUUID(),
      type: "tool",
      role: "tool",
      tool_call_id: wait.value.workflowCallId,
      name: workflow === "a2a" ? "run_a2a_workflow" : "run_report_workflow",
      content: "External task finished",
    });
    thread.messages.push({
      id: randomUUID(),
      type: "ai",
      role: "assistant",
      content: replies[workflow][result.status],
    });
    await publishCard(
      threadId,
      input.metadata.agui_run_id,
      wait.value.workflowCallId,
      "reviewed",
      workflow === "a2a" ? titles[result.status] : "Generated report",
      lines,
      workflow === "a2a"
        ? {
            surfaceId: `a2a-${wait.value.workflowCallId}-result`,
            groupId: wait.value.workflowCallId,
          }
        : undefined,
    );
    thread.review = null;
    delete thread.externalWorkflow;

    return context.json(run);
  });
  api.post("/threads/:id/runs/stream", async (context) => {
    const input = requestSchema.parse(await context.req.json());
    const threadId = context.req.param("id");
    const thread = threadFor(threadId);
    const run = {
      run_id: randomUUID(),
      thread_id: threadId,
      status: "pending",
      config: { metadata: input.metadata },
    };

    thread.runs.push(run);

    return streamSSE(context, async (stream) => {
      async function event(event: string, data: unknown) {
        await stream.writeSSE({ event, data: JSON.stringify(data) });
      }

      async function modelChunk(
        messageId: string,
        content: string,
        toolCallChunks?: object[],
        additionalKwargs?: Record<string, unknown>,
      ) {
        await event("events", {
          event: LangGraphEventTypes.OnChatModelStream,
          metadata: { langgraph_node: "agent", run_id: run.run_id },
          data: {
            chunk: {
              id: messageId,
              content,
              response_metadata: {},
              additional_kwargs: additionalKwargs ?? {},
              tool_call_chunks: toolCallChunks ?? [],
            },
          },
        });
      }

      async function endModel() {
        await event("events", {
          event: LangGraphEventTypes.OnChatModelEnd,
          metadata: { langgraph_node: "agent" },
          data: {},
        });
      }

      async function toolResult(
        message: LangGraphPlatformMessage,
        toolName?: string,
      ) {
        // The CSV tool returns its own ToolMessage without a name or ID; the
        // graph reducer supplies the canonical archived identity afterward.
        const output =
          toolName === "run_skill_script"
            ? { ...message, name: null, id: null }
            : message;

        await event("events", {
          event: LangGraphEventTypes.OnToolEnd,
          name: toolName ?? message.name,
          metadata: { langgraph_node: "tools" },
          data: { input: {}, output },
        });
      }

      async function reply(text: string, heldPrefix?: string) {
        const messageId = randomUUID();

        if (heldPrefix !== undefined) {
          const released = new Promise<void>((resolve) => {
            thread.release = resolve;
          });

          await modelChunk(messageId, heldPrefix);
          await released;
          delete thread.release;
          await modelChunk(messageId, text.slice(heldPrefix.length));
        } else {
          await modelChunk(messageId, text);
        }

        await endModel();
        thread.messages.push({
          id: messageId,
          type: "ai",
          role: "assistant",
          content: text,
        });
      }

      await event("metadata", { run_id: run.run_id, thread_id: threadId });

      async function requestInteraction(
        name: string,
        args: Record<string, unknown>,
      ) {
        const callId = randomUUID();
        const messageId = randomUUID();

        await modelChunk(messageId, "", [
          { id: callId, name, args: "", index: 0 },
        ]);
        await modelChunk(messageId, "", [
          { args: JSON.stringify(args), index: 0 },
        ]);
        await endModel();
        thread.messages.push({
          id: messageId,
          type: "ai",
          role: "assistant",
          content: "",
          tool_calls: [{ id: callId, name, args }],
        });
        thread.interactionCall = { callId, name };
        thread.review = {
          id: randomUUID(),
          value: {
            action_requests: [
              {
                name,
                args,
                description: "Export the report using the published script.",
              },
            ],
            review_configs: [
              {
                action_name: name,
                allowed_decisions:
                  name === "ask_user"
                    ? ["respond", "reject"]
                    : ["approve", "reject"],
              },
            ],
          },
        };
      }

      if (input.command && thread.interactionCall && thread.review) {
        const interaction = parseAgentInteraction({
          id: thread.review.id,
          metadata: { langgraph: { raw: thread.review.value } },
        })!;
        const wrapped = z.record(z.unknown()).parse(input.command.resume);
        const response = interactionResponse(
          interaction,
          wrapped[interaction.interruptId] ?? wrapped,
        );

        if (!response) {
          throw new Error("Invalid native HITL fixture response");
        }

        const decisions = z
          .object({
            decisions: z.array(
              z.object({ type: z.string(), message: z.string().optional() }),
            ),
          })
          .parse(response.payload).decisions;
        const decision = decisions[0]!;
        const { callId, name } = thread.interactionCall;
        let content = decision.message ?? "Report exported";

        if (decision.type === "reject") {
          // Match LangChain's error ToolMessage so clients can distinguish a
          // skipped question from execution failure without displaying diagnostics.
          content = decision.message
            ? `User rejected the tool call for \`${name}\` with reason: ${decision.message}`
            : `User rejected the tool call for \`${name}\` with id ${callId}. The tool was not executed. Do not retry this tool call unless the user explicitly requests it.`;
        }

        const result = {
          id: randomUUID(),
          type: "tool" as const,
          role: "tool",
          name,
          tool_call_id: callId,
          content,
          status: decision.type === "reject" ? "error" : "success",
        };

        thread.review = null;
        delete thread.interactionCall;
        thread.messages.push(result);

        if (decision.type === "respond" || decision.type === "reject") {
          // Native HITL decisions bypass tool execution and return from this
          // middleware node before the next model starts.
          await event("events", {
            event: LangGraphEventTypes.OnChainEnd,
            name: "InteractionMiddleware.after_model",
            metadata: { langgraph_node: "InteractionMiddleware.after_model" },
            data: { output: { messages: [result] } },
          });
        } else {
          await toolResult(result, name);
        }

        if (
          name === "ask_user" &&
          decision.type === "respond" &&
          thread.holdInteractionReply
        ) {
          delete thread.holdInteractionReply;
          await reply(
            "I received your report preferences. The report is ready.",
            "I received your report preferences.",
          );
        } else if (name === "ask_user" && decision.type === "respond") {
          await requestInteraction("run_skill_script", {
            skill_name: "reports",
            script_path: "scripts/export.py",
            arguments: ["--audience", "engineering"],
          });
        } else if (
          name === "run_skill_script" &&
          decision.type === "approve" &&
          thread.followupApproval
        ) {
          delete thread.followupApproval;
          await requestInteraction("remember_memory", {
            text: "Reports are intended for engineering.",
            category: "preference",
          });
        } else {
          await reply(
            decision.type === "reject"
              ? "Report export was not run."
              : "Report export completed.",
          );
        }
      } else if (input.command && thread.sql) {
        const currentReview = thread.sql.review;
        const wrapped = z.record(z.unknown()).parse(input.command.resume);
        const response = workflowReviewResponseSchema.parse(
          wrapped[currentReview.id] ?? wrapped,
        );
        const card = await thread.sql.publish(
          input.metadata.agui_run_id,
          response,
        );

        thread.review =
          thread.sql.submitted || thread.sql.abandoned
            ? null
            : thread.sql.review;
        await event("events", {
          event: LangGraphEventTypes.OnCustomEvent,
          name: "a2ui",
          metadata: { langgraph_node: "tools" },
          data: card,
        });

        if (!thread.review) {
          const result = {
            id: randomUUID(),
            type: "tool" as const,
            role: "tool",
            content: thread.sql.submitted ? "SQL submitted" : "SQL abandoned",
            tool_call_id: thread.sql.callId,
            name: "run_sql_workflow",
          };

          thread.messages.push(result);
          await toolResult(result);
          delete thread.sql;
        }
      } else if (input.command) {
        const { title, steps } = resumeSchema.parse(input.command.resume);
        const callId = thread.review?.value.workflowCallId;

        if (!callId) {
          throw new Error("Cannot resume a thread without a review");
        }

        thread.review = null;
        const result = {
          id: randomUUID(),
          type: "tool" as const,
          role: "tool",
          content: `Approved ${title}`,
          tool_call_id: callId,
          name: "run_experiment_workflow",
        };

        thread.messages.push(result);
        await toolResult(result);
        const card = await publishCard(
          threadId,
          input.metadata.agui_run_id,
          callId,
          "reviewed",
          title,
          steps,
        );

        await event("events", {
          event: LangGraphEventTypes.OnCustomEvent,
          name: "a2ui",
          metadata: { langgraph_node: "tools" },
          data: card,
        });
        await reply(`The experiment plan ${title} is approved.`);
      } else {
        const message = input.input?.messages.at(-1);

        if (!message) {
          throw new Error("Fixture requires a user message");
        }

        thread.messages.push({ ...message, type: "human" });

        const prompt =
          typeof message.content === "string"
            ? message.content
            : message.content
                .flatMap((part) =>
                  part.type === "text" && typeof part.text === "string"
                    ? [part.text]
                    : [],
                )
                .join("\n");

        if (prompt === "Report the selected model") {
          await reply(
            `Selected model: ${input.config?.configurable?.model_id ?? "none"}`,
          );
        } else if (Array.isArray(message.content)) {
          const images = message.content.filter(
            (part) => part.type === "image_url",
          );
          const source = z
            .object({ url: z.string() })
            .parse(images[0]?.image_url);
          const expected =
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

          if (images.length !== 1 || source.url !== expected) {
            throw new Error("Fixture received unexpected image bytes");
          }

          await reply("The uploaded PNG pixel data reached the model.");
        } else if (prompt === "Is the previous image still available?") {
          const previousImage = thread.messages.some(
            (message) =>
              message.type === "human" &&
              Array.isArray(message.content) &&
              message.content.some(
                (part) =>
                  typeof part === "object" &&
                  part !== null &&
                  "type" in part &&
                  part.type === "image_url",
              ),
          );

          if (!previousImage) {
            throw new Error("Fixture lost the image from checkpoint history");
          }

          await reply("The previous image is still in model history.");
        } else if (
          prompt === "Prepare a report with user input and approval." ||
          prompt ===
            "Prepare a report with user input and consecutive approvals." ||
          prompt === "Ask for report preferences and keep the response open."
        ) {
          thread.holdInteractionReply =
            prompt === "Ask for report preferences and keep the response open.";
          thread.followupApproval =
            prompt ===
            "Prepare a report with user input and consecutive approvals.";
          await requestInteraction("ask_user", {
            questions: [
              {
                id: "audience",
                question: "Who will read this report?",
                options: [
                  {
                    label: "Engineering",
                    description: "Include technical details and evidence.",
                  },
                  {
                    label: "Leadership",
                    description: "Focus on outcomes and decisions.",
                  },
                ],
              },
              { id: "deadline", question: "When do you need the report?" },
            ],
          });
        } else if (prompt === "Investigate a reliability regression.") {
          async function updatePlan(
            todos: {
              content: string;
              status: "pending" | "in_progress" | "completed";
            }[],
          ) {
            const messageId = randomUUID();
            const callId = randomUUID();
            const args = { todos };

            await modelChunk(messageId, "", [
              { id: callId, name: "write_todos", args: "", index: 0 },
            ]);
            await modelChunk(messageId, "", [
              { args: JSON.stringify(args), index: 0 },
            ]);
            await endModel();
            thread.messages.push({
              id: messageId,
              type: "ai",
              role: "assistant",
              content: "",
              tool_calls: [{ id: callId, name: "write_todos", args }],
            });
            const result = {
              id: randomUUID(),
              type: "tool" as const,
              role: "tool",
              name: "write_todos",
              tool_call_id: callId,
              content: `Updated todo list to ${JSON.stringify(todos)}`,
            };

            // Official planning tools return Command updates rather than a bare result.
            await event("events", {
              event: LangGraphEventTypes.OnToolEnd,
              name: "write_todos",
              metadata: { langgraph_node: "tools" },
              data: {
                input: args,
                output: { update: { todos, messages: [result] } },
              },
            });
            thread.messages.push(result);
          }

          const released = new Promise<void>((resolve) => {
            thread.release = resolve;
          });

          await updatePlan([
            { content: "Compare failure rates", status: "in_progress" },
            { content: "Summarize the evidence", status: "pending" },
          ]);
          await released;
          delete thread.release;
          await updatePlan([
            { content: "Compare failure rates", status: "completed" },
            { content: "Check deployment changes", status: "completed" },
            { content: "Summarize the evidence", status: "completed" },
          ]);
          await reply(
            "The deployment change explains the increased failure rate.",
          );
        } else if (prompt === "Compare approaches with reasoning.") {
          const messageId = randomUUID();
          const reasoning =
            "First, compare the constraints. Then check the tradeoffs.";
          const thoughtReleased = new Promise<void>((resolve) => {
            thread.release = resolve;
          });

          await modelChunk(messageId, "", undefined, {
            reasoning_content: "First, compare the constraints. ",
          });
          await modelChunk(messageId, "", undefined, {
            reasoning_content: "Then check the tradeoffs.",
          });
          await thoughtReleased;
          delete thread.release;
          const answerReleased = new Promise<void>((resolve) => {
            thread.release = resolve;
          });

          await modelChunk(messageId, "Approach A is simpler.");
          await answerReleased;
          delete thread.release;
          await modelChunk(messageId, " Approach B is more flexible.");
          await endModel();
          thread.messages.push({
            id: messageId,
            type: "ai",
            role: "assistant",
            content: "Approach A is simpler. Approach B is more flexible.",
            additional_kwargs: { reasoning_content: reasoning },
          });
        } else if (prompt.startsWith("Stream a code sample.")) {
          await reply(
            "Here is a C example.\n\n```c\nint main(void) {\n  return 0;\n}\n```",
            "Here is a C example.\n\n",
          );
        } else if (prompt === "Write a long reply.") {
          const paragraphs = Array.from(
            { length: 8 },
            (_, index) =>
              `Paragraph ${index + 1}: This reply contains enough text to exercise the message viewport as more content appears.`,
          );

          await reply([...paragraphs, "End of the long reply."].join("\n\n"));
        } else {
          const workflow = prompt.includes("run_experiment_workflow");
          const sqlWorkflow =
            prompt.includes("run_sql_workflow") ||
            prompt.includes("SQL review workflow");
          const reportWorkflow = prompt.includes("report workflow");
          const a2aWorkflow = prompt.includes("run_a2a_workflow");
          const memoryTool = prompt === "Remember a durable preference.";
          let name = "get_current_time";

          if (memoryTool) {
            name = "remember_memory";
          } else if (a2aWorkflow) {
            name = "run_a2a_workflow";
          } else if (reportWorkflow) {
            name = "run_report_workflow";
          } else if (workflow) {
            name = "run_experiment_workflow";
          } else if (sqlWorkflow) {
            name = "run_sql_workflow";
          }

          const callId = randomUUID();
          const messageId = randomUUID();
          const args = memoryTool
            ? { text: "Prefer concise answers.", category: "preference" }
            : {};

          await modelChunk(messageId, "", [
            { id: callId, name, args: "", index: 0 },
          ]);
          await modelChunk(messageId, "", [
            { args: JSON.stringify(args), index: 0 },
          ]);
          await endModel();
          thread.messages.push({
            id: messageId,
            type: "ai",
            role: "assistant",
            content: "",
            tool_calls: [{ id: callId, name, args }],
          });

          if (reportWorkflow || a2aWorkflow) {
            const { registerExternalTask } =
              await import("../../src/conversation/tasks/task-store.js");
            const taskId = randomUUID();

            await registerExternalTask({
              taskId,
              threadId,
              runId: input.metadata.agui_run_id,
              workflowCallId: callId,
              stepId: a2aWorkflow ? "a2a" : "report",
              label: a2aWorkflow ? "A2A collaboration" : "Generate report",
            });
            thread.externalWorkflow = a2aWorkflow ? "a2a" : "report";
            thread.review = {
              id: randomUUID(),
              value: {
                kind: "workflow_external_wait",
                taskId,
                workflowCallId: callId,
              },
            };
          } else if (sqlWorkflow) {
            thread.sql = new ControlledSqlWorkflow(database, threadId, callId);
            const card = await thread.sql.publish(input.metadata.agui_run_id);

            thread.review = thread.sql.review;
            await event("events", {
              event: LangGraphEventTypes.OnCustomEvent,
              name: "a2ui",
              metadata: { langgraph_node: "tools" },
              data: card,
            });
          } else if (workflow) {
            const value = {
              kind: "experiment_plan_review",
              workflowCallId: callId,
              title: "Agent workflow validation",
              steps: ["Check streaming", "Check recovery"],
            };

            thread.review = { id: randomUUID(), value };
            const card = await publishCard(
              threadId,
              input.metadata.agui_run_id,
              callId,
              "review",
              value.title,
              value.steps,
            );

            await event("events", {
              event: LangGraphEventTypes.OnCustomEvent,
              name: "a2ui",
              metadata: { langgraph_node: "tools" },
              data: card,
            });
          } else if (memoryTool) {
            const result = {
              type: "tool" as const,
              role: "tool",
              content: JSON.stringify({ memory: { text: args.text } }),
              tool_call_id: callId,
              status: "success" as const,
              name: null,
              id: null,
            };

            // Match the real LangMem trace inside remember_memory. This internal
            // tool returns a string without the model's public tool-call ID.
            await event("events", {
              event: LangGraphEventTypes.OnToolEnd,
              name: "manage_memory",
              metadata: { langgraph_node: "tools" },
              data: { input: { action: "update" }, output: "updated memory" },
            });
            await event("events", {
              event: LangGraphEventTypes.OnToolEnd,
              name,
              metadata: { langgraph_node: "tools" },
              data: { input: args, output: { update: { messages: [result] } } },
            });
            thread.messages.push({ ...result, id: randomUUID(), name });

            // Keep the run open so the test observes success before checkpoint
            // recovery can overwrite a transient stream failure.
            await new Promise<void>((resolve) => {
              thread.release = resolve;
            });
            delete thread.release;
            await reply("Preference saved.");
          } else {
            const result = {
              id: randomUUID(),
              type: "tool" as const,
              role: "tool",
              content: "2026-09-29T00:00:00Z",
              tool_call_id: callId,
              name,
            };

            thread.messages.push(result);
            await toolResult(result);
            await reply("The current time is 2026-09-29 00:00 UTC.");
          }
        }
      }

      run.status = thread.review ? "interrupted" : "success";
      await event("values", stateFor(threadId).values);
    });
  });
  api.notFound((context) =>
    context.json(
      {
        error: `Unexpected fixture request: ${context.req.method} ${context.req.path}`,
      },
      501,
    ),
  );

  function release(threadId: string) {
    const thread = threads.get(threadId);

    if (!thread?.release) {
      return false;
    }

    thread.release();

    return true;
  }

  function releaseAll() {
    for (const thread of threads.values()) {
      thread.release?.();
    }
  }

  function seedConversation(id: string, messages: LangGraphPlatformMessage[]) {
    threadFor(id).messages = messages;
  }

  return { api, release, releaseAll, seedConversation };
}
