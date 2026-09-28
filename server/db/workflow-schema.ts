import {
  bigint,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Python owns this table and its migration; the server only reads it.
export const workflowOutputs = pgTable("workflow_outputs", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  aguiRunId: text("agui_run_id").notNull(),
  workflowCallId: text("workflow_call_id").notNull(),
  stepId: text("step_id").notNull(),
  stepSeq: integer("step_seq").notNull(),
  outputSeq: bigint("output_seq", { mode: "number" }).notNull(),
  kind: text("kind").notNull(),
  version: integer("version").notNull(),
  payload: jsonb("payload").$type<{ messages: unknown[] }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
