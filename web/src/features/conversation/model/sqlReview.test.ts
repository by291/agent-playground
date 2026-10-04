import { expect, test } from "vitest";
import { InterruptSchema } from "@ag-ui/client";
import { parseSqlReview, sqlResponse } from "@shared/sql-review";

const interrupt = InterruptSchema.parse({
  id: "sql-review-1",
  reason: "Review SQL",
  metadata: {
    langgraph: {
      raw: {
        kind: "sql_review",
        workflowCallId: "call",
        revision: 2,
        round: 1,
        outputStepId: "review:1",
        sql: "SELECT id FROM orders",
        originalSql: "SELECT * FROM orders",
        check: { passed: false, issues: ["Fix the query"] },
      },
    },
  },
});

test("SQL reviews bind actions to their current round and block failed acceptance", () => {
  const review = parseSqlReview(interrupt)!;

  expect(review.revision).toBe(2);
  expect(sqlResponse(review, "accept")).toBeNull();
  expect(sqlResponse(review, "abandon")?.payload).toMatchObject({
    action: "abandon",
    workflowCallId: "call",
    revision: 2,
    round: 1,
  });
});
