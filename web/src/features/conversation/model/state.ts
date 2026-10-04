import type { BaseEvent, Interrupt, Message } from "@ag-ui/client";
import type { ContextUsage } from "@shared/context-usage";
import type { A2UISurfaceView } from "@/features/a2ui";
import type { ConversationSnapshot } from "../api/contracts";
import type { ConversationLifecycle } from "./lifecycle";
import type { PlanReviewResponse } from "./planReview";
import type { WorkflowReview } from "@shared/workflow-review";

export interface Activity {
  id: string;
  receivedAt: number;
  runId: string;
  event: BaseEvent;
}

export interface ConversationState {
  title?: string | undefined;
  contextUsage: ContextUsage | null;
  runs: ConversationSnapshot["runs"];
  messages: Message[];
  surfaces: A2UISurfaceView[];
  activity: Activity[];
  activityReceived: number;
  pendingInterrupts: Interrupt[];
  lifecycle: ConversationLifecycle;
  animatedMessageId: string | null;
  issues: {
    run: string | null;
    snapshot: string | null;
    output: string | null;
  };
  send: (content: string) => Promise<void>;
  clearActivity: () => void;
  reviewPlan: (responses: PlanReviewResponse[]) => Promise<void>;
  reviewWorkflow: (
    review: WorkflowReview,
    action: "accept" | "abandon",
  ) => Promise<void>;
}
