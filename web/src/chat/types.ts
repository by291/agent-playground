import type { Message } from "@ag-ui/client";
import type { A2UICard } from "../a2ui/card";
import type {
  PlanReview,
  PlanReviewResponse,
} from "../conversation/planReview";

export interface ChatPaneProps {
  messages: Message[];
  cards: A2UICard[];
  reviews: PlanReview[];
  waitingForReview: boolean;
  running: boolean;
  recoveryIssue: string | null;
  onSend: (message: string) => Promise<void>;
  onReview: (responses: PlanReviewResponse[]) => Promise<void>;
}
