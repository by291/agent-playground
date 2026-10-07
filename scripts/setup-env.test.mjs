import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { test } from "node:test";
import { parse } from "yaml";
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
    join(directory, "agent.example.yaml"),
    'workflow:\n  api_token: ""\n',
  );
  await writeFile(
    join(directory, "server/.env.example"),
    "WORKFLOW_API_TOKEN=\n",
  );
  await writeFile(
    join(directory, "web/.env.example"),
    "BACKEND_URL=http://127.0.0.1:3000\n",
  );
  await writeFile(
    join(directory, "models.example.yaml"),
    'chat:\n  default: deepseek\n  api_key: ""\n',
  );
}

test("setup creates private YAML and shares a generated token without a root dotenv file", async () => {
  const directory = await temporaryDirectory();

  try {
    await createExamples(directory);

    const result = runSetup(directory);

    assert.equal(result.status, 0, result.stderr);

    const agent = parse(await readFile(join(directory, "agent.yaml"), "utf8"));
    const server = await readFile(join(directory, "server/.env"), "utf8");

    assert.match(agent.workflow.api_token, /^[a-f0-9]{64}$/);
    assert.equal(
      /^WORKFLOW_API_TOKEN=(.+)$/m.exec(server)?.[1],
      agent.workflow.api_token,
    );
    await assert.rejects(access(join(directory, ".env")), { code: "ENOENT" });
    assert.equal(
      await readFile(join(directory, "web/.env"), "utf8"),
      "BACKEND_URL=http://127.0.0.1:3000\n",
    );
    assert.equal(
      await readFile(join(directory, "models.yaml"), "utf8"),
      'chat:\n  default: deepseek\n  api_key: ""\n',
    );

    if (process.platform !== "win32") {
      for (const file of [
        "agent.yaml",
        "models.yaml",
        "server/.env",
        "web/.env",
      ]) {
        assert.equal((await stat(join(directory, file))).mode & 0o777, 0o600);
      }
    }
  } finally {
    await removeDirectory(directory);
  }
});

test("setup preserves complete existing settings and root dotenv on repeated runs", async () => {
  const directory = await temporaryDirectory();
  const agent = '# Local settings\nworkflow:\n  api_token: "existing-token"\n';
  const root = "WORKFLOW_API_TOKEN=obsolete-token\r\n";
  const server = "WORKFLOW_API_TOKEN=existing-token\r\n";
  const web = "BACKEND_URL=http://custom:3000\r\n";
  const models = 'chat:\n  api_key: "keep-private-key"\n';

  try {
    await createExamples(directory);
    await writeFile(join(directory, "agent.yaml"), agent);
    await writeFile(join(directory, ".env"), root);
    await writeFile(join(directory, "server/.env"), server);
    await writeFile(join(directory, "web/.env"), web);
    await writeFile(join(directory, "models.yaml"), models);

    assert.equal(runSetup(directory).status, 0);
    assert.equal(runSetup(directory).status, 0);
    assert.equal(await readFile(join(directory, "agent.yaml"), "utf8"), agent);
    assert.equal(await readFile(join(directory, ".env"), "utf8"), root);
    assert.equal(
      await readFile(join(directory, "server/.env"), "utf8"),
      server,
    );
    assert.equal(await readFile(join(directory, "web/.env"), "utf8"), web);
    assert.equal(
      await readFile(join(directory, "models.yaml"), "utf8"),
      models,
    );
  } finally {
    await removeDirectory(directory);
  }
});

test("setup fills a blank Agent token from the existing server token and preserves YAML comments", async () => {
  const directory = await temporaryDirectory();

  try {
    await createExamples(directory);
    await writeFile(
      join(directory, "agent.yaml"),
      '# Keep this comment\nworkflow:\n  api_token: ""\n',
    );
    await writeFile(
      join(directory, "server/.env"),
      'WORKFLOW_API_TOKEN="existing-token"\n',
    );

    const result = runSetup(directory);

    assert.equal(result.status, 0, result.stderr);

    const agent = await readFile(join(directory, "agent.yaml"), "utf8");

    assert.match(agent, /# Keep this comment/);
    assert.equal(parse(agent).workflow.api_token, "existing-token");
    assert.equal(
      await readFile(join(directory, "server/.env"), "utf8"),
      'WORKFLOW_API_TOKEN="existing-token"\n',
    );
  } finally {
    await removeDirectory(directory);
  }
});

for (const token of [
  "$&",
  "$literal#key",
  'a"quoted#token',
  "a'quoted#token",
  "both\"quotes'#token",
  "literal\\n#token",
]) {
  test(`setup preserves custom token syntax ${JSON.stringify(token)} in server dotenv`, async () => {
    const directory = await temporaryDirectory();

    try {
      await createExamples(directory);
      await writeFile(
        join(directory, "agent.yaml"),
        `workflow:\n  api_token: ${JSON.stringify(token)}\n`,
      );

      const result = runSetup(directory);

      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        parseEnv(await readFile(join(directory, "server/.env"), "utf8"))
          .WORKFLOW_API_TOKEN,
        token,
      );
      assert.equal(
        parse(await readFile(join(directory, "agent.yaml"), "utf8")).workflow
          .api_token,
        token,
      );
    } finally {
      await removeDirectory(directory);
    }
  });
}

test("setup rejects conflicting tokens without changing existing files or exposing values", async () => {
  const directory = await temporaryDirectory();
  const agent = 'workflow:\n  api_token: "agent-private-token"\n';
  const server = "WORKFLOW_API_TOKEN=server-private-token\n";

  try {
    await createExamples(directory);
    await writeFile(join(directory, "agent.yaml"), agent);
    await writeFile(join(directory, "server/.env"), server);

    const result = runSetup(directory);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /WORKFLOW_API_TOKEN must match/);
    assert.doesNotMatch(
      result.stderr,
      /agent-private-token|server-private-token/,
    );
    assert.equal(await readFile(join(directory, "agent.yaml"), "utf8"), agent);
    assert.equal(
      await readFile(join(directory, "server/.env"), "utf8"),
      server,
    );
  } finally {
    await removeDirectory(directory);
  }
});

test("setup hides malformed YAML credentials in its diagnostic", async () => {
  const directory = await temporaryDirectory();

  try {
    await createExamples(directory);
    await writeFile(
      join(directory, "agent.yaml"),
      "workflow:\n  api_token: [private-token\n",
    );

    const result = runSetup(directory);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /agent.yaml must contain valid YAML/);
    assert.doesNotMatch(result.stderr, /private-token/);
  } finally {
    await removeDirectory(directory);
  }
});
