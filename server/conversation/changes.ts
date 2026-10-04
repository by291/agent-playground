import { sql } from "drizzle-orm";
import type { db } from "../db/database";

export async function notifyConversation(
  database: Pick<typeof db, "execute">,
  threadId: string,
) {
  await database.execute(
    sql`SELECT pg_notify('conversation_changed', ${threadId})`,
  );
}
