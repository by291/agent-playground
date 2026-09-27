ALTER TABLE "conversation_messages" DROP CONSTRAINT "conversation_messages_pkey";--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_thread_id_message_id_pk" PRIMARY KEY("thread_id","message_id");
