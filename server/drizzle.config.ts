import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./db/schema.ts",
    "./db/external-task-schema.ts",
    "./db/skill-file-schema.ts",
  ],
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.APP_DATABASE_URL ?? "postgresql://localhost/agent_playground",
  },
});
