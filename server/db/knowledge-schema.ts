import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const vector = customType<{ data: string }>({ dataType: () => "vector" });

export const knowledgeDocuments = pgTable("knowledge_documents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  objectKey: text("object_key").notNull(),
  status: text("status").notNull().default("uploading"),
  error: text("error"),
  textEncoding: text("text_encoding"),
  chunkCount: integer("chunk_count").notNull().default(0),
  generation: text("generation"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  embeddingProfile: text("embedding_profile"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  objectDeletedAt: timestamp("object_deleted_at", { withTimezone: true }),
  cleanupAttemptedAt: timestamp("cleanup_attempted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    langchainId: text("langchain_id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    generation: text("generation").notNull(),
    embeddingProfile: text("embedding_profile").notNull(),
    visible: boolean("visible").notNull().default(false),
    content: text("content").notNull(),
    embedding: vector("embedding").notNull(),
    langchainMetadata: jsonb("langchain_metadata").notNull().default({}),
  },
  (table) => [index("knowledge_chunks_document_index").on(table.documentId)],
);
