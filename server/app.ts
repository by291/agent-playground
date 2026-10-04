import { Hono } from "hono";
import { agentRoutes } from "./http/agent-routes";
import { conversationRoutes } from "./http/conversation-routes";
import { externalTaskRoutes } from "./http/external-task-routes";
import { skillFileRoutes } from "./http/skill-file-routes";
import { telemetry } from "./observability/ingestion";

export const app = new Hono();
app.get("/health", (context) => context.text("ok"));
app.route("/telemetry", telemetry);
app.route("/", agentRoutes);
app.route("/conversations", conversationRoutes);
app.route("/", externalTaskRoutes);
app.route("/", skillFileRoutes);
