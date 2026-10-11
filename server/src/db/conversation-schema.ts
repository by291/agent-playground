import {
  bigint,
  boolean,
  integer,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { Interrupt, Message, RunAgentInput } from "@ag-ui/client";
import { runStatuses } from "../../../shared/run-status.js";
import type { ContextUsage } from "../../../shared/context-usage.js";

export const conversations = pgTable(
  "conversations",
  {
    threadId: text("thread_id").primaryKey(),
    title: text("title").notNull().default("Untitled conversation"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`date_trunc('milliseconds', now())`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    contextUsage: jsonb("context_usage").$type<ContextUsage>(),
    modelId: text("model_id"),
    nextSubmitSeq: bigint("next_submit_seq", { mode: "number" })
      .notNull()
      .default(1),
    nextOutputSeq: bigint("next_output_seq", { mode: "number" })
      .notNull()
      .default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("conversations_recent_index")
      .on(table.updatedAt, table.threadId)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const conversationRuns = pgTable(
  "conversation_runs",
  {
    aguiRunId: text("agui_run_id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => conversations.threadId),
    submitSeq: bigint("submit_seq", { mode: "number" }).notNull(),
    messageId: text("message_id").notNull(),
    request: jsonb("request").$type<RunAgentInput>().notNull(),
    modelId: text("model_id"),
    aegraRunId: text("aegra_run_id"),
    status: text("status", { enum: runStatuses }).notNull(),
    checkpointSynced: boolean("checkpoint_synced").notNull().default(false),
    interrupts: jsonb("interrupts").$type<Interrupt[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("conversation_runs_thread_message_unique").on(
      table.threadId,
      table.messageId,
    ),
    uniqueIndex("conversation_runs_thread_seq_unique").on(
      table.threadId,
      table.submitSeq,
    ),
  ],
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    messageId: text("message_id").notNull(),
    threadId: text("thread_id")
      .notNull()
      .references(() => conversations.threadId),
    submitSeq: bigint("submit_seq", { mode: "number" }).notNull(),
    messageOrder: integer("message_order").notNull().default(0),
    message: jsonb("message").$type<Message>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.messageId] })],
);

export type RunRow = typeof conversationRuns.$inferSelect;
