import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Ownership is checked under the conversation lock; pending uploads precede admission.
export const skillFiles = pgTable(
  "skill_files",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    runId: text("run_id"),
    name: text("name").notNull(),
    size: integer("size").notNull(),
    objectKey: text("object_key").notNull(),
    sha256: text("sha256").notNull(),
    ready: boolean("ready").notNull().default(false),
    objectDeletedAt: timestamp("object_deleted_at", { withTimezone: true }),
    cleanupAttemptedAt: timestamp("cleanup_attempted_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("skill_files_thread_index").on(table.threadId)],
);
