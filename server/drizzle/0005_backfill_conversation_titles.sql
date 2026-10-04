UPDATE "conversations" AS c
SET "title" = COALESCE((
  SELECT left(trim(regexp_replace(m.message->>'content', '\s+', ' ', 'g')), 100)
  FROM "conversation_messages" AS m
  WHERE m.thread_id = c.thread_id
    AND m.message->>'role' = 'user'
    AND jsonb_typeof(m.message->'content') = 'string'
    AND NULLIF(trim(regexp_replace(m.message->>'content', '\s+', ' ', 'g')), '') IS NOT NULL
  ORDER BY m.submit_seq, m.message_order, m.created_at
  LIMIT 1
), c.title),
"updated_at" = date_trunc('milliseconds', GREATEST(c.created_at, COALESCE((
  SELECT max(r.created_at) FROM "conversation_runs" AS r WHERE r.thread_id = c.thread_id
), c.created_at)))
WHERE c.title = 'Untitled conversation';
