import { randomUUID } from "node:crypto";
import { RunAgentInputSchema } from "@ag-ui/client";
import { db } from "../db/database";
import { aegraUrl, prepareAegraRequest } from "../agent/client";
import { Client } from "@langchain/langgraph-sdk";
import {
  isExternalTaskTerminal,
  parseExternalWait,
} from "../../shared/external-task";
import {
  admitRun,
  claimPreparedDispatch,
  latestRun,
  recordAegraRun,
} from "./run-store";
import { synchronizeConversation } from "./checkpoint-sync";
import { notifyConversation } from "./changes";
import { logger } from "../observability/logger";
import { scanExternalTasks } from "./external-task-scan";
import { fetchAgentInfo } from "../agent/info";

// Background requests own their deadline and abort signal independently of live streams.
function createWorkerClient(signal?: AbortSignal) {
  return new Client({
    apiUrl: aegraUrl,
    timeoutMs: 10000,
    callerOptions: { maxRetries: 0 },
    onRequest: (url, init) => {
      const prepared = prepareAegraRequest(url, init);

      return signal
        ? {
            ...prepared,
            signal: AbortSignal.any([
              signal,
              ...(prepared.signal ? [prepared.signal] : []),
            ]),
          }
        : prepared;
    },
  });
}

const continuationClient = createWorkerClient();

export async function processExternalTasks(
  client: Client = continuationClient,
  signal?: AbortSignal,
) {
  const synchronizedThreads = new Set<string>();

  for await (const { task, continuation } of scanExternalTasks()) {
    if (signal?.aborted) {
      break;
    }

    try {
      if (!synchronizedThreads.has(task.threadId)) {
        await synchronizeConversation(task.threadId, client);
        synchronizedThreads.add(task.threadId);
      }

      if (!isExternalTaskTerminal(task.status)) {
        continue;
      }

      let run = continuation;

      if (!run) {
        const latest = await latestRun(task.threadId);
        const wait = latest?.interrupts
          .map(parseExternalWait)
          .find(
            (value) =>
              value?.taskId === task.taskId &&
              value.workflowCallId === task.workflowCallId,
          );

        if (latest?.status !== "interrupted" || !wait) {
          continue;
        }

        const runId = randomUUID();
        const input = RunAgentInputSchema.parse({
          threadId: task.threadId,
          runId,
          messages: [],
          tools: [],
          context: [],
          state: {},
          resume: [
            {
              interruptId: wait.interruptId,
              status: "resolved",
              payload: {
                ...task.update,
                kind: "external_task_result",
                taskId: task.taskId,
              },
            },
          ],
        });
        const admitted = await admitRun({
          threadId: task.threadId,
          runId,
          messageId: `external-${task.taskId}`,
          request: input,
          userMessage: null,
          isResume: true,
          externalTaskId: task.taskId,
          agentInfo: await fetchAgentInfo(signal),
        });

        run = admitted.row;
      }

      if (signal?.aborted || run.status !== "prepared") {
        continue;
      }

      const releaseDispatch = await claimPreparedDispatch(run.aguiRunId);

      if (!releaseDispatch) {
        continue;
      }

      try {
        const entry = run.request.resume?.[0];

        if (!entry) {
          throw new Error("External continuation has no resume entry");
        }

        // A durable admission precedes upstream creation. Unknown outcomes use the
        // existing mapping reconciliation, never an unconfirmed second creation.
        const payload: unknown = entry.payload;
        const config = {
          configurable: run.modelId ? { model_id: run.modelId } : {},
          metadata: { agui_run_id: run.aguiRunId },
        };
        const created = await client.runs.create(task.threadId, "agent", {
          command: { resume: { [entry.interruptId]: payload } },
          config,
          metadata: { agui_run_id: run.aguiRunId },
          multitaskStrategy: "reject",
        });

        await recordAegraRun(run.aguiRunId, created.run_id);
      } finally {
        releaseDispatch();
      }

      await synchronizeConversation(task.threadId, client);
      await notifyConversation(db, task.threadId);
    } catch (error) {
      logger.warn(
        { err: error, task_id: task.taskId },
        "External task continuation will be reconciled",
      );
    }
  }
}

export function startExternalTaskWorker() {
  const controller = new AbortController();
  const client = createWorkerClient(controller.signal);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = Promise.resolve();

  function tick() {
    running = processExternalTasks(client, controller.signal)
      .catch((error: unknown) => {
        logger.error({ err: error }, "External task scan failed");
      })
      .finally(() => {
        if (!stopped) {
          timer = setTimeout(tick, 1000);
        }
      });
  }

  tick();

  return async () => {
    stopped = true;
    clearTimeout(timer);
    controller.abort();
    await running;
  };
}
