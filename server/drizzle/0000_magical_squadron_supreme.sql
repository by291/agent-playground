CREATE TABLE "conversation_messages" (
	"message_id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"submit_seq" bigint NOT NULL,
	"message" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_runs" (
	"agui_run_id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"submit_seq" bigint NOT NULL,
	"message_id" text NOT NULL,
	"request" jsonb NOT NULL,
	"aegra_run_id" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"thread_id" text PRIMARY KEY NOT NULL,
	"next_submit_seq" bigint DEFAULT 1 NOT NULL,
	"next_output_seq" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_thread_id_conversations_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."conversations"("thread_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_runs" ADD CONSTRAINT "conversation_runs_thread_id_conversations_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."conversations"("thread_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_runs_thread_message_unique" ON "conversation_runs" USING btree ("thread_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_runs_thread_seq_unique" ON "conversation_runs" USING btree ("thread_id","submit_seq");