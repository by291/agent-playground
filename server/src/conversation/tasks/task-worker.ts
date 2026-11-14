import { randomUUID } from "node:crypto";
import { RunAgentInputSchema } from "../../../../shared/ag-ui-schemas.js";
import { db } from "../../db/database.js";
import { aegraUrl, prepareAegraRequest } from "../../agent/aegra-client.js";
import { Client } from "@langchain/langgraph-sdk";
import {
  isExternalTaskTerminal,
  parseExternalWait,
} from "../../../../shared/external-task.js";
import { admitRun } from "../runs/run-admission.js";
import {
  claimPreparedDispatch,
  latestRun,
  recordAegraRun,
} from "../runs/run-store.js";
import { synchronizeConversation } from "../runs/checkpoint-sync.js";
import { notifyConversation } from "../events/publish.js";
import { logger } from "../../observability/logger.js";
import { scanExternalTasks, type ScannedExternalTask } from "./task-scan.js";
import { fetchAgentInfo } from "../../agent/agent-info.js";

const CONTINUATION_TIMEOUT_MS = 10_000;
const TASK_POLL_INTERVAL_MS = 1_000;

// Background requests own their deadline and abort signal independently of live streams.
function createWorkerClient(signal?: AbortSignal) {
  return new Client({
    apiUrl: aegraUrl,
    timeoutMs: CONTINUATION_TIMEOUT_MS,
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

async function admitContinuation(
  task: ScannedExternalTask["task"],
  signal?: AbortSignal,
) {
  const latest = await latestRun(task.threadId);
  const wait = latest?.interrupts
    .map(parseExternalWait)
    .find(
      (value) =>
        value?.taskId === task.taskId &&
        value.workflowCallId === task.workflowCallId,
    );

  if (latest?.status !== "interrupted" || !wait) {
    return null;
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

  return admitted.row;
}

async function dispatchContinuation(
  run: NonNullable<ScannedExternalTask["continuation"]>,
  client: Client,
): Promise<void> {
  const releaseDispatch = await claimPreparedDispatch(run.aguiRunId);

  if (!releaseDispatch) {
    return;
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
    const created = await client.runs.create(run.threadId, "agent", {
      command: { resume: { [entry.interruptId]: payload } },
      config,
      metadata: { agui_run_id: run.aguiRunId },
      multitaskStrategy: "reject",
    });

    await recordAegraRun(run.aguiRunId, created.run_id);
  } finally {
    await releaseDispatch();
  }

  await synchronizeConversation(run.threadId, client);
  await notifyConversation(db, run.threadId);
}

/** Reconcile active external tasks and dispatch their admitted continuations. */
export async function processExternalTasks(
  client: Client = continuationClient,
  signal?: AbortSignal,
): Promise<void> {
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

      // A retried scan reuses a continuation that was admitted before dispatch.
      const run = continuation ?? (await admitContinuation(task, signal));

      if (signal?.aborted || run?.status !== "prepared") {
        continue;
      }

      await dispatchContinuation(run, client);
    } catch (error) {
      logger.warn(
        { err: error, task_id: task.taskId },
        "External task continuation will be reconciled",
      );
    }
  }
}

/** Start a serialized scan loop and return its cancellation and drain function. */
export function startExternalTaskWorker() {
  const controller = new AbortController();
  const client = createWorkerClient(controller.signal);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = Promise.resolve();

  function tick() {
    // Schedule after settlement so scans never overlap or outlive their shutdown owner.
    running = processExternalTasks(client, controller.signal)
      .catch((error: unknown) => {
        logger.error({ err: error }, "External task scan failed");
      })
      .finally(() => {
        if (!stopped) {
          timer = setTimeout(tick, TASK_POLL_INTERVAL_MS);
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
