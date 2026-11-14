ALTER TABLE "conversation_runs" ADD COLUMN "dispatch_token" text;--> statement-breakpoint
ALTER TABLE "conversation_runs" ADD COLUMN "dispatch_lease_until" timestamp with time zone;
