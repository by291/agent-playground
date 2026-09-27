import {
  bigint,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const conversations = pgTable("conversations", {
  threadId: text("thread_id").primaryKey(),
  nextSubmitSeq: bigint("next_submit_seq", { mode: "number" })
    .notNull()
    .default(1),
  nextOutputSeq: bigint("next_output_seq", { mode: "number" })
    .notNull()
    .default(1),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const conversationRuns = pgTable(
  "conversation_runs",
  {
    aguiRunId: text("agui_run_id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => conversations.threadId),
    submitSeq: bigint("submit_seq", { mode: "number" }).notNull(),
    messageId: text("message_id").notNull(),
    request: jsonb("request").notNull(),
    aegraRunId: text("aegra_run_id"),
    status: text("status", {
      enum: [
        "prepared",
        "dispatching",
        "running",
        "interrupted",
        "completed",
        "failed",
        "submission_unknown",
      ],
    }).notNull(),
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
    message: jsonb("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.messageId] })],
);

export type RunRow = typeof conversationRuns.$inferSelect;
