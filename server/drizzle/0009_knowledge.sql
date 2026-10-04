CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"langchain_id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"generation" text NOT NULL,
	"embedding_profile" text NOT NULL,
	"visible" boolean DEFAULT false NOT NULL,
	"content" text NOT NULL,
	"embedding" vector NOT NULL,
	"langchain_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"object_key" text NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"error" text,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"generation" text,
	"lease_until" timestamp with time zone,
	"embedding_profile" text,
	"deleted_at" timestamp with time zone,
	"cleanup_attempted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_chunks_document_index" ON "knowledge_chunks" USING btree ("document_id");