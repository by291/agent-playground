import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { removeDirectory, temporaryDirectory } from "./test-helpers.mjs";

const setupScript = fileURLToPath(new URL("./setup-env.mjs", import.meta.url));

function runSetup(directory) {
  return spawnSync(process.execPath, [setupScript], {
    cwd: directory,
    encoding: "utf8",
    windowsHide: true,
  });
}

async function createExamples(directory) {
  await mkdir(join(directory, "server"));
  await mkdir(join(directory, "web"));
  await writeFile(
    join(directory, ".env.example"),
    "DEEPSEEK_API_KEY=\nWORKFLOW_API_TOKEN=\n",
  );
  await writeFile(
    join(directory, "server/.env.example"),
    "WORKFLOW_API_TOKEN=\n",
  );
  await writeFile(
    join(directory, "web/.env.example"),
    "BACKEND_URL=http://127.0.0.1:3000\n",
  );
}

test("environment setup creates all missing files and shares one generated token", async () => {
  const directory = await temporaryDirectory();

  try {
    await createExamples(directory);

    const result = runSetup(directory);

    assert.equal(result.status, 0, result.stderr);

    const root = await readFile(join(directory, ".env"), "utf8");
    const server = await readFile(join(directory, "server/.env"), "utf8");
    const token = /^WORKFLOW_API_TOKEN=([a-f0-9]{64})$/m.exec(root)?.[1];

    assert.ok(token);
    assert.equal(/^WORKFLOW_API_TOKEN=(.+)$/m.exec(server)?.[1], token);
    assert.equal(
      await readFile(join(directory, "web/.env"), "utf8"),
      "BACKEND_URL=http://127.0.0.1:3000\n",
    );
  } finally {
    await removeDirectory(directory);
  }
});

test("environment setup preserves existing settings and tokens on repeated runs", async () => {
  const directory = await temporaryDirectory();
  const root =
    "DEEPSEEK_API_KEY=existing\r\nWORKFLOW_API_TOKEN=existing-token\r\n";
  const server = "WORKFLOW_API_TOKEN=existing-token\r\n";
  const web = "BACKEND_URL=http://custom:3000\r\n";

  try {
    await createExamples(directory);
    await writeFile(join(directory, ".env"), root);
    await writeFile(join(directory, "server/.env"), server);
    await writeFile(join(directory, "web/.env"), web);

    assert.equal(runSetup(directory).status, 0);
    assert.equal(runSetup(directory).status, 0);
    assert.equal(await readFile(join(directory, ".env"), "utf8"), root);
    assert.equal(
      await readFile(join(directory, "server/.env"), "utf8"),
      server,
    );
    assert.equal(await readFile(join(directory, "web/.env"), "utf8"), web);
  } finally {
    await removeDirectory(directory);
  }
});

test("environment setup rejects conflicting tokens without changing existing files", async () => {
  const directory = await temporaryDirectory();
  const root = "WORKFLOW_API_TOKEN=root-token\n";
  const server = "WORKFLOW_API_TOKEN=server-token\n";

  try {
    await createExamples(directory);
    await writeFile(join(directory, ".env"), root);
    await writeFile(join(directory, "server/.env"), server);

    const result = runSetup(directory);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /WORKFLOW_API_TOKEN must match/);
    assert.equal(await readFile(join(directory, ".env"), "utf8"), root);
    assert.equal(
      await readFile(join(directory, "server/.env"), "utf8"),
      server,
    );
  } finally {
    await removeDirectory(directory);
  }
});
