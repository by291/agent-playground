import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./src/db/conversation-schema.ts",
    "./src/db/external-task-schema.ts",
    "./src/db/skill-file-schema.ts",
    "./src/db/knowledge-schema.ts",
  ],
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.APP_DATABASE_URL ?? "postgresql://localhost/agent_playground",
  },
});
