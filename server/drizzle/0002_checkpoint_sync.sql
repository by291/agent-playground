ALTER TABLE "conversation_messages" ADD COLUMN "message_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_runs" ADD COLUMN "checkpoint_synced" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_runs" ADD COLUMN "interrupts" jsonb DEFAULT '[]'::jsonb NOT NULL;