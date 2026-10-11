import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { db } from "../../src/db/database.js";
import {
  workflowReviewSchema,
  type WorkflowReviewResponse,
} from "../../../shared/workflow-review.js";
import type { SqlCard } from "../../../shared/sql-card.js";

export class ControlledSqlWorkflow {
  revision = 2;
  round = 0;
  currentSql = "SELECT id, amount FROM orders;";
  passed = true;
  submitted = false;
  abandoned = false;

  constructor(
    private database: typeof db,
    private threadId: string,
    readonly callId: string,
  ) {}

  get review() {
    return {
      id: `sql-${this.callId}-review-${this.round}`,
      value: workflowReviewSchema.parse({
        kind: "workflow_review",
        workflowCallId: this.callId,
        revision: this.revision,
        round: this.round,
        outputStepId: `review:${this.round}`,
        canAccept: this.passed,
        title: "SQL decision",
        acceptLabel: "Accept and submit",
        messagePlaceholder: "Ask about this SQL or describe a change…",
        ...(!this.passed
          ? {
              blockedReason:
                "SQL must pass its current check before submission.",
            }
          : {}),
      }),
    };
  }

  async publish(runId: string, response?: WorkflowReviewResponse) {
    let reply = "Replaced the wildcard with explicit columns.";

    if (response?.action === "message") {
      if (response.message.toLowerCase().includes("explain")) {
        reply =
          "Explicit columns keep the result predictable when the schema changes.";
      } else if (response.message.toLowerCase().includes("wildcard")) {
        this.currentSql = "SELECT * FROM orders;";
        this.revision += 1;
        this.passed = false;
        reply = "The wildcard version fails the demo check.";
      } else {
        this.currentSql = "SELECT amount FROM orders;";
        this.revision += 1;
        this.passed = true;
        reply = "Updated the query to return only amounts.";
      }
    } else if (response?.action === "accept") {
      this.submitted = true;
      reply = "The demo API recorded the accepted SQL without executing it.";
    } else if (response?.action === "abandon") {
      this.abandoned = true;
      reply = "The SQL workflow was abandoned. Nothing was submitted.";
    }

    this.round += 1;
    let status: SqlCard["status"] = "review";

    if (this.submitted) {
      status = "submitted";
    } else if (this.abandoned) {
      status = "abandoned";
    }

    const card: SqlCard = {
      workflowCallId: this.callId,
      sql: this.currentSql,
      originalSql: "SELECT * FROM orders;",
      revision: this.revision,
      round: this.round,
      status,
      check: {
        passed: this.passed,
        issues: this.passed ? [] : ["Use explicit columns."],
      },
      ...(this.submitted
        ? { receiptId: `sql-${this.callId}-${this.revision}` }
        : {}),
    };
    const surfaceId = `sql-${this.callId}-${this.round}`;
    const replyId = `sql-${this.callId}-reply-${this.round}`;
    const payload = {
      workflow: {
        reply: { id: replyId, content: reply },
        presentation: {
          surfaceId,
          groupId: this.callId,
          anchorMessageId: replyId,
        },
      },
      messages: [
        {
          version: "v0.9",
          createSurface: {
            surfaceId,
            catalogId: "urn:agent-playground:workflow:v1",
          },
        },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId,
            components: [{ id: "root", component: "WorkflowSql", ...card }],
          },
        },
      ],
    };
    const id = randomUUID();
    const outputSeq = await this.database.transaction(async (tx) => {
      const result = await tx.execute<{ output_seq: string }>(sql`
        UPDATE conversations SET next_output_seq = next_output_seq + 1
        WHERE thread_id = ${this.threadId} RETURNING next_output_seq - 1 AS output_seq
      `);
      const sequence = Number(result.rows[0]!.output_seq);

      await tx.execute(sql`
        INSERT INTO workflow_outputs
          (id, thread_id, agui_run_id, workflow_call_id, step_id, step_seq, output_seq, kind, version, payload)
        VALUES (${id}, ${this.threadId}, ${runId}, ${this.callId}, ${`${status}:${this.round}`}, ${this.round}, ${sequence}, 'a2ui', 3, ${JSON.stringify(payload)}::jsonb)
      `);

      return sequence;
    });

    return {
      id,
      aguiRunId: runId,
      workflowCallId: this.callId,
      toolCallId: this.callId,
      outputSeq,
      ...payload,
    };
  }
}
