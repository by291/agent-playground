import { Hono } from "hono";
import { agentRoutes } from "./routes/agent-routes.js";
import { conversationRoutes } from "./routes/conversation-routes.js";
import { externalTaskRoutes } from "./routes/external-task-routes.js";
import { knowledgeRoutes } from "./routes/knowledge-routes.js";
import { memoryRoutes } from "./routes/memory-routes.js";
import { skillFileRoutes } from "./routes/skill-file-routes.js";
import { telemetry } from "./routes/telemetry-routes.js";

export const app = new Hono();

app.get("/health", (context) => context.text("ok"));
app.route("/telemetry", telemetry);
app.route("/", agentRoutes);
app.route("/conversations", conversationRoutes);
app.route("/", externalTaskRoutes);
app.route("/", skillFileRoutes);
app.route("/", knowledgeRoutes);
app.route("/", memoryRoutes);
