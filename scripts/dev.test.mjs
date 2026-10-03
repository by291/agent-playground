import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { launchProcesses, stopProcesses } from "./dev.mjs";

async function waitForFile(path) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT" || attempt === 39) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

test("background launcher reuses live processes and stops descendants", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-playground-dev-"));
  const readyMarker = join(directory, "child.pid");
  const stoppedMarker = join(directory, "child-stopped");
  const grandchildCode = [
    "const { writeFileSync } = require('node:fs');",
    "process.on('SIGTERM', () => { writeFileSync(process.argv[2], 'stopped'); process.exit(0); });",
    "writeFileSync(process.argv[1], 'ready');",
    "setInterval(() => {}, 1000);",
  ].join(" ");
  const parentCode = [
    "const { spawn } = require('node:child_process');",
    `spawn(process.execPath, ['-e', ${JSON.stringify(grandchildCode)}, process.argv[1], process.argv[2]], { stdio: 'ignore' });`,
    "setInterval(() => {}, 1000);",
  ].join(" ");
  const commands = [
    {
      name: "sample",
      command: process.execPath,
      args: ["-e", parentCode, readyMarker, stoppedMarker],
    },
  ];

  try {
    const started = await launchProcesses(directory, commands);
    assert.equal(started.length, 1);
    assert.doesNotThrow(() => process.kill(started[0].pid, 0));
    assert.deepEqual(await launchProcesses(directory, commands), started);
    await assert.rejects(
      launchProcesses(directory, commands, "observability"),
      /already running/,
    );
    await waitForFile(readyMarker);

    await stopProcesses(directory);
    assert.equal(await waitForFile(stoppedMarker), "stopped");
  } finally {
    await stopProcesses(directory);
    await rm(directory, { recursive: true, force: true });
  }
});
