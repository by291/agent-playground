import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { a2aCommands, launchProcesses, stopProcesses } from "./dev.mjs";
import {
  forceStop,
  isRunning,
  removeDirectory,
  temporaryDirectory,
  waitFor,
} from "./test-helpers.mjs";

async function waitForFile(path) {
  let content = "";

  await waitFor(async () => {
    try {
      content = await readFile(path, "utf8");

      // File creation is observable before the child finishes writing its marker.
      return content.length > 0;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }

      return false;
    }
  });

  return content;
}

test("independent A2A services use runtime YAML without importing root dotenv or fixed ports", () => {
  const commands = a2aCommands();

  assert.deepEqual(
    commands.map(({ name }) => name),
    ["a2a-planner", "a2a-reviewer"],
  );

  for (const { args } of commands) {
    assert.equal(args.includes("--env-file"), false);
    assert.equal(args.includes(".env"), false);
    assert.equal(args.includes("--port"), false);
  }
});

test("background launcher reuses live processes and stops descendants", async () => {
  const directory = await temporaryDirectory();
  const readyMarker = join(directory, "child.pid");
  const stoppedMarker = join(directory, "child-stopped");
  const grandchildCode = [
    "const { writeFileSync } = require('node:fs');",
    "process.on('SIGTERM', () => { writeFileSync(process.argv[2], 'stopped'); process.exit(0); });",
    "writeFileSync(process.argv[1], JSON.stringify({ pid: process.pid }));",
    "setInterval(() => {}, 1000);",
  ].join(" ");
  const parentCode = [
    "const { spawn } = require('node:child_process');",
    `spawn(process.execPath, ['-e', ${JSON.stringify(grandchildCode)}, process.argv[1], process.argv[2]], { stdio: 'ignore', windowsHide: true });`,
    "setInterval(() => {}, 1000);",
  ].join(" ");
  const commands = [
    {
      name: "sample",
      command: process.execPath,
      args: ["-e", parentCode, readyMarker, stoppedMarker],
    },
  ];
  let started = [];
  let grandchildPid;

  try {
    started = await launchProcesses(directory, commands);
    assert.equal(started.length, 1);
    assert.doesNotThrow(() => process.kill(started[0].pid, 0));
    assert.deepEqual(await launchProcesses(directory, commands), started);
    await assert.rejects(
      launchProcesses(directory, commands, "observability"),
      /already running/,
    );
    grandchildPid = JSON.parse(await waitForFile(readyMarker)).pid;

    await stopProcesses(directory);

    assert.equal(isRunning(started[0].pid), false);
    await assert.rejects(access(join(directory, "processes.json")), {
      code: "ENOENT",
    });

    if (process.platform === "win32") {
      assert.equal(isRunning(grandchildPid), false);
    } else {
      assert.equal(await waitForFile(stoppedMarker), "stopped");
    }
  } finally {
    for (const { pid } of started) {
      await forceStop(pid);
    }

    if (process.platform === "win32") {
      await forceStop(grandchildPid);
    }

    await removeDirectory(directory);
  }
});

test(
  "POSIX stop signals surviving descendants after their launcher exits",
  {
    skip: process.platform === "win32",
  },
  async () => {
    const directory = await temporaryDirectory();
    const readyMarker = join(directory, "orphan.pid");
    const stoppedMarker = join(directory, "orphan-stopped");
    const grandchildCode = [
      "const { writeFileSync } = require('node:fs');",
      "process.on('SIGTERM', () => { writeFileSync(process.argv[2], 'stopped'); process.exit(0); });",
      "writeFileSync(process.argv[1], JSON.stringify({ pid: process.pid }));",
      "setInterval(() => {}, 1000);",
    ].join(" ");
    const parentCode = [
      "const { spawn } = require('node:child_process');",
      `const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildCode)}, process.argv[1], process.argv[2]], { stdio: 'ignore' });`,
      "child.unref();",
    ].join(" ");
    let started = [];

    try {
      started = await launchProcesses(directory, [
        {
          name: "orphan",
          command: process.execPath,
          args: ["-e", parentCode, readyMarker, stoppedMarker],
        },
      ]);

      const descendant = JSON.parse(await waitForFile(readyMarker));

      await waitFor(() => !isRunning(started[0].pid));
      assert.equal(isRunning(descendant.pid), true);

      await stopProcesses(directory);

      assert.equal(await waitForFile(stoppedMarker), "stopped");
      await assert.rejects(access(join(directory, "processes.json")), {
        code: "ENOENT",
      });
    } finally {
      for (const { pid } of started) {
        await forceStop(pid);
      }

      await removeDirectory(directory);
    }
  },
);
