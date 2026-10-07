import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { parseDocument } from "yaml";

function serializeToken(token) {
  if (/[\r\n]/.test(token)) {
    throw new Error("workflow.api_token must be a single-line value.");
  }

  if (/^[A-Za-z0-9._~-]+$/.test(token)) {
    return token;
  }

  for (const delimiter of ['"', "'", "`"]) {
    const serialized = `${delimiter}${token}${delimiter}`;

    if (
      !token.includes(delimiter) &&
      parseEnv(`WORKFLOW_API_TOKEN=${serialized}\n`).WORKFLOW_API_TOKEN ===
        token
    ) {
      return serialized;
    }
  }

  throw new Error(
    "workflow.api_token must be representable as a quoted value in server/.env.",
  );
}

// Exclusive private copies preserve local settings when setup is repeated.
for (const [source, destination] of [
  ["agent.example.yaml", "agent.yaml"],
  ["models.example.yaml", "models.yaml"],
  ["server/.env.example", "server/.env"],
  ["web/.env.example", "web/.env"],
]) {
  try {
    writeFileSync(destination, readFileSync(source), {
      flag: "wx",
      mode: 0o600,
    });
    console.log(`Created ${destination}.`);
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }
}

const agentContent = readFileSync("agent.yaml", "utf8");
const agent = parseDocument(agentContent);

if (agent.errors.length > 0) {
  // YAML diagnostics may quote a line containing a credential.
  throw new Error("agent.yaml must contain valid YAML.");
}

const document = agent.toJS();

if (
  document === null ||
  typeof document !== "object" ||
  Array.isArray(document) ||
  (document.workflow !== undefined &&
    (document.workflow === null ||
      typeof document.workflow !== "object" ||
      Array.isArray(document.workflow)))
) {
  throw new Error("agent.yaml and workflow must contain YAML mappings.");
}

const agentToken = agent.getIn(["workflow", "api_token"]);
const serverContent = readFileSync("server/.env", "utf8");
const serverToken = parseEnv(serverContent).WORKFLOW_API_TOKEN;

if (agentToken !== undefined && typeof agentToken !== "string") {
  throw new Error("workflow.api_token in agent.yaml must be a string.");
}

if (agentToken && serverToken && agentToken !== serverToken) {
  throw new Error(
    "WORKFLOW_API_TOKEN must match workflow.api_token in agent.yaml and server/.env",
  );
}

const token = agentToken || serverToken || randomBytes(32).toString("hex");
const serializedToken = serverToken ? undefined : serializeToken(token);

if (!agentToken) {
  agent.setIn(["workflow", "api_token"], token);
  writeFileSync("agent.yaml", agent.toString());
}

if (!serverToken) {
  const updated = /^WORKFLOW_API_TOKEN=/m.test(serverContent)
    ? serverContent.replace(
        /^WORKFLOW_API_TOKEN=[^\r\n]*/m,
        () => `WORKFLOW_API_TOKEN=${serializedToken}`,
      )
    : `${serverContent}\nWORKFLOW_API_TOKEN=${serializedToken}\n`;

  writeFileSync("server/.env", updated);
}
