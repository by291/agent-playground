import type { Interrupt, Message } from "@ag-ui/client";
import type { ContextUsage } from "@shared/context-usage";
import type { A2UISurfaceView } from "@/features/a2ui";
import type { ConversationSnapshot } from "../api/contracts";
import type { ConversationLifecycle } from "./lifecycle";
import type { PlanReviewResponse } from "./planReview";

export interface Activity {
  id: string;
  type: string;
  detail?: string;
}

export interface ConversationState {
  title?: string | undefined;
  contextUsage: ContextUsage | null;
  runs: ConversationSnapshot["runs"];
  messages: Message[];
  surfaces: A2UISurfaceView[];
  activity: Activity[];
  pendingInterrupts: Interrupt[];
  lifecycle: ConversationLifecycle;
  animatedMessageId: string | null;
  issues: {
    run: string | null;
    snapshot: string | null;
    output: string | null;
  };
  send: (content: string) => Promise<void>;
  reviewPlan: (responses: PlanReviewResponse[]) => Promise<void>;
}
