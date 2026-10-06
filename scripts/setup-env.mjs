import { constants, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

// Exclusive copies preserve local settings when setup is repeated.
for (const path of [".env", "server/.env", "web/.env"]) {
  try {
    copyFileSync(`${path}.example`, path, constants.COPYFILE_EXCL);
    console.log(`Created ${path}.`);
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }
}

const paths = [".env", "server/.env"];
const contents = paths.map((path) => readFileSync(path, "utf8"));
const tokens = contents.map(
  (content) => /^WORKFLOW_API_TOKEN=([^\r\n]+)$/m.exec(content)?.[1],
);

if (tokens[0] && tokens[1] && tokens[0] !== tokens[1]) {
  throw new Error("WORKFLOW_API_TOKEN must match in .env and server/.env");
}

const token = tokens.find(Boolean) ?? randomBytes(32).toString("hex");

for (const [index, path] of paths.entries()) {
  const content = contents[index];

  if (!tokens[index]) {
    const updated = /^WORKFLOW_API_TOKEN=/m.test(content)
      ? content.replace(
          /^WORKFLOW_API_TOKEN=[^\r\n]*/m,
          `WORKFLOW_API_TOKEN=${token}`,
        )
      : `${content}\nWORKFLOW_API_TOKEN=${token}\n`;

    writeFileSync(path, updated);
  }
}
