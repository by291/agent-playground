ALTER TABLE "conversations" ADD COLUMN "title" text DEFAULT 'Untitled conversation' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "conversations_recent_index" ON "conversations" USING btree ("updated_at","thread_id") WHERE "conversations"."deleted_at" IS NULL;