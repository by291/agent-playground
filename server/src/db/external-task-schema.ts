import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { conversations, conversationRuns } from "./conversation-schema.js";
import type { ExternalTaskUpdate } from "../../../shared/external-task.js";

export const externalTasks = pgTable(
  "external_tasks",
  {
    taskId: text("task_id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => conversations.threadId),
    workflowCallId: text("workflow_call_id").notNull(),
    stepId: text("step_id").notNull(),
    label: text("label").notNull(),
    callbackToken: text("callback_token").notNull(),
    status: text("status").$type<ExternalTaskUpdate["status"]>().notNull(),
    revision: integer("revision").notNull().default(0),
    update: jsonb("update").$type<ExternalTaskUpdate>().notNull(),
    continuationRunId: text("continuation_run_id").references(
      () => conversationRuns.aguiRunId,
    ),
  },
  (table) => [
    uniqueIndex("external_tasks_workflow_step_unique").on(
      table.threadId,
      table.workflowCallId,
      table.stepId,
    ),
  ],
);

export const externalTaskEvents = pgTable(
  "external_task_events",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => externalTasks.taskId),
    revision: integer("revision").notNull(),
    update: jsonb("update").$type<ExternalTaskUpdate>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.revision] })],
);
