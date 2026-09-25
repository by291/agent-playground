import {
  EventType,
  RunAgentInputSchema,
  type RunErrorEvent,
  type RunStartedEvent,
} from "@ag-ui/client";
import { LangGraphAgent } from "@ag-ui/langgraph";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import {
  concatMap,
  filter,
  lastValueFrom,
  map,
  materialize,
  Subject,
  takeUntil,
} from "rxjs";

const aegraUrl = process.env.AEGRA_URL ?? "http://127.0.0.1:2026";

export const app = new Hono();

app.get("/health", (context) => context.text("ok"));

app.post(
  "/agent",
  bodyLimit({
    maxSize: 1_000_000,
    onError: (context) =>
      context.json({ error: "Request body is too large" }, 413),
  }),
  async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    const input = RunAgentInputSchema.safeParse(body);
    if (!input.success)
      return context.json({ error: "Invalid AG-UI input" }, 400);

    // The adapter keeps run state, so each request gets its own instance.
    const agent = new LangGraphAgent({
      graphId: "agent",
      deploymentUrl: aegraUrl,
    });
    context.header("Cache-Control", "no-cache, no-transform");
    context.header("X-Accel-Buffering", "no");

    return streamSSE(context, async (stream) => {
      const cancelled = new Subject<void>();
      let lastSnapshot: string | undefined;
      let runStarted = false;
      let terminalEventSent = false;

      stream.onAbort(() => {
        agent.abortRun();
        cancelled.next();
        cancelled.complete();
      });

      try {
        await lastValueFrom(
          agent.run(input.data).pipe(
            filter((event) => {
              if (event.type === EventType.RAW) return false;
              if (event.type !== EventType.STATE_SNAPSHOT) return true;

              const snapshot = JSON.stringify(event.snapshot);
              if (snapshot === lastSnapshot) return false;
              lastSnapshot = snapshot;
              return true;
            }),
            map((event) => {
              const output = { ...event } as Record<string, unknown>;
              delete output.rawEvent;
              return output;
            }),
            // Treat an upstream error as the last queued item so earlier writes finish.
            materialize(),
            concatMap(async (notification) => {
              if (notification.kind === "E") throw notification.error;
              if (notification.kind !== "N") return;

              const event = notification.value;
              if (
                !runStarted &&
                (event.type === EventType.RUN_ERROR ||
                  event.type === EventType.RUN_FINISHED)
              ) {
                const runStart: RunStartedEvent = {
                  type: EventType.RUN_STARTED,
                  threadId: input.data.threadId,
                  runId: input.data.runId,
                };
                await stream.writeSSE({ data: JSON.stringify(runStart) });
                runStarted = true;
              }
              await stream.writeSSE({ data: JSON.stringify(event) });
              if (event.type === EventType.RUN_STARTED) runStarted = true;
              if (
                event.type === EventType.RUN_ERROR ||
                event.type === EventType.RUN_FINISHED
              )
                terminalEventSent = true;
            }),
            takeUntil(cancelled),
          ),
          { defaultValue: undefined },
        );
      } catch (error) {
        console.error("Agent stream failed", error ?? "Unknown error");
        if (!stream.aborted && !terminalEventSent) {
          if (!runStarted) {
            const runStart: RunStartedEvent = {
              type: EventType.RUN_STARTED,
              threadId: input.data.threadId,
              runId: input.data.runId,
            };
            await stream.writeSSE({ data: JSON.stringify(runStart) });
          }
          const runError: RunErrorEvent = {
            type: EventType.RUN_ERROR,
            message: "Agent run failed",
          };
          await stream.writeSSE({
            data: JSON.stringify(runError),
          });
        }
      }
    });
  },
);
