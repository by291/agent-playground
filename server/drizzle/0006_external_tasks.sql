CREATE TABLE "external_task_events" (
	"task_id" text NOT NULL,
	"revision" integer NOT NULL,
	"update" jsonb NOT NULL,
	CONSTRAINT "external_task_events_task_id_revision_pk" PRIMARY KEY("task_id","revision")
);
--> statement-breakpoint
CREATE TABLE "external_tasks" (
	"task_id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"workflow_call_id" text NOT NULL,
	"step_id" text NOT NULL,
	"label" text NOT NULL,
	"callback_token" text NOT NULL,
	"status" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"update" jsonb NOT NULL,
	"continuation_run_id" text
);
--> statement-breakpoint
ALTER TABLE "external_task_events" ADD CONSTRAINT "external_task_events_task_id_external_tasks_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."external_tasks"("task_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_tasks" ADD CONSTRAINT "external_tasks_thread_id_conversations_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."conversations"("thread_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_tasks" ADD CONSTRAINT "external_tasks_continuation_run_id_conversation_runs_agui_run_id_fk" FOREIGN KEY ("continuation_run_id") REFERENCES "public"."conversation_runs"("agui_run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_tasks_workflow_step_unique" ON "external_tasks" USING btree ("thread_id","workflow_call_id","step_id");--> statement-breakpoint
CREATE FUNCTION public.notify_conversation_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;
  PERFORM pg_notify('conversation_changed', NEW.thread_id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER conversation_run_changed AFTER INSERT OR UPDATE ON public.conversation_runs FOR EACH ROW EXECUTE FUNCTION public.notify_conversation_change();
--> statement-breakpoint
CREATE TRIGGER conversation_message_changed AFTER INSERT ON public.conversation_messages FOR EACH ROW EXECUTE FUNCTION public.notify_conversation_change();
