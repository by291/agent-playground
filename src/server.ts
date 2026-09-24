import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { createHttpServer } from "./http.js";
import { createAgentRuntime } from "./runtime.js";

const databaseUrl = requireEnv("DATABASE_URL");
const apiKey = requireEnv("OPENAI_API_KEY");
const model = requireEnv("OPENAI_MODEL");
const port = Number(process.env.PORT ?? "3000");
const host = process.env.HOST ?? "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const runtime = await createAgentRuntime({
  databaseUrl,
  model: new ChatOpenAI({
    apiKey,
    model,
    configuration: process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : undefined,
  }),
});
const server = createHttpServer(runtime);
server.listen(port, host, () => {
  console.log(`Agent runtime listening on http://${host}:${port}`);
});

async function shutdown() {
  server.close();
  await runtime.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
