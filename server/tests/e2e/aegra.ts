import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  LangGraphEventTypes,
  type LangGraphPlatformMessage,
} from "@ag-ui/langgraph";
import type { db } from "../../db/database";

const resumeSchema = z.object({
  decision: z.literal("approve"),
  title: z.string(),
  steps: z.string().array(),
});
const requestSchema = z.object({
  input: z
    .object({
      messages: z.array(z.object({ id: z.string(), content: z.string() })),
    })
    .optional(),
  command: z.object({ resume: resumeSchema }).optional(),
  metadata: z.object({ agui_run_id: z.string() }),
});

interface Thread {
  messages: LangGraphPlatformMessage[];
  review: {
    id: string;
    value: {
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
}

// Only the Aegra HTTP boundary is controlled. The browser, adapter, server and
// PostgreSQL use the real application code and do not intercept frontend traffic.
export function controlledAegra(database: typeof db) {
  const api = new Hono();
  const threads = new Map<string, Thread>();

  api.get("/agent-info", (context) => context.json({ model: "test-model" }));

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
  ) {
    const surfaceId = `experiment-${callId}-${stage}`;
    const payload = {
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
      ) {
        await event("events", {
          event: LangGraphEventTypes.OnChatModelStream,
          metadata: { langgraph_node: "agent", run_id: run.run_id },
          data: {
            chunk: {
              id: messageId,
              content,
              response_metadata: {},
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

      async function toolResult(message: LangGraphPlatformMessage) {
        await event("events", {
          event: LangGraphEventTypes.OnToolEnd,
          metadata: { langgraph_node: "tools" },
          data: { input: {}, output: message },
        });
      }

      async function reply(text: string, held = false) {
        const messageId = randomUUID();

        if (held) {
          const released = new Promise<void>((resolve) => {
            thread.release = resolve;
          });

          await modelChunk(messageId, "Here is a C example.\n\n");
          await released;
          delete thread.release;
          await modelChunk(
            messageId,
            text.slice("Here is a C example.\n\n".length),
          );
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

      if (input.command) {
        const { title, steps } = input.command.resume;
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

        thread.messages.push({ ...message, type: "human", role: "user" });

        if (message.content === "Stream a code sample.") {
          await reply(
            "Here is a C example.\n\n```c\nint main(void) {\n  return 0;\n}\n```",
            true,
          );
        } else if (message.content === "Write a long reply.") {
          const paragraphs = Array.from(
            { length: 40 },
            (_, index) =>
              `Paragraph ${index + 1}: This reply contains enough text to exercise the message viewport as more content appears.`,
          );

          await reply([...paragraphs, "End of the long reply."].join("\n\n"));
        } else {
          const workflow = message.content.includes("run_experiment_workflow");
          const name = workflow
            ? "run_experiment_workflow"
            : "get_current_time";
          const callId = randomUUID();
          const messageId = randomUUID();

          await modelChunk(messageId, "", [
            { id: callId, name, args: "", index: 0 },
          ]);
          await modelChunk(messageId, "", [{ args: "{}", index: 0 }]);
          await endModel();
          thread.messages.push({
            id: messageId,
            type: "ai",
            role: "assistant",
            content: "",
            tool_calls: [{ id: callId, name, args: {} }],
          });

          if (workflow) {
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

  return { api, release, releaseAll };
}
