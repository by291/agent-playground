import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { access, copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { launchProcesses, stopProcesses } from "./dev.mjs";
import {
  forceStop,
  isRunning,
  pnpmFixture,
  removeDirectory,
  temporaryDirectory,
  waitFor,
} from "./test-helpers.mjs";

const execFileAsync = promisify(execFile);
const devScript = fileURLToPath(new URL("./dev.mjs", import.meta.url));

test(
  "Windows stop waits for the managed process to exit before deleting its journal",
  {
    skip: process.platform !== "win32",
  },
  async () => {
    const directory = await temporaryDirectory();
    const journal = join(directory, "processes.json");
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      },
    );

    try {
      await once(child, "spawn");
      child.unref();
      await writeFile(
        journal,
        JSON.stringify([{ name: "sample", pid: child.pid }]),
      );

      await stopProcesses(directory);

      assert.equal(isRunning(child.pid), false);
      await assert.rejects(access(journal), { code: "ENOENT" });
      assert.deepEqual(await stopProcesses(directory), []);
    } finally {
      await forceStop(child.pid);
      await removeDirectory(directory);
    }
  },
);

test("background launcher supports pnpm command wrappers and paths containing spaces", async () => {
  const directory = await temporaryDirectory();
  const marker = join(directory, "ready marker.json");
  const code = [
    'import { writeFileSync } from "node:fs";',
    "writeFileSync(process.argv[2], JSON.stringify({ args: process.argv.slice(3), enabled: process.env.VITE_OBSERVABILITY_ENABLED }));",
    'console.log("sample stdout");',
    'console.error("sample stderr");',
    "setInterval(() => {}, 1000);",
  ].join("\n");
  let started = [];

  try {
    const env = {
      ...(await pnpmFixture(directory, code)),
      VITE_OBSERVABILITY_ENABLED: "true",
    };

    started = await launchProcesses(directory, [
      {
        name: "sample",
        command: "pnpm",
        args: [marker, "dev:web"],
        env,
      },
    ]);

    await waitFor(async () => {
      try {
        await access(marker);

        return true;
      } catch {
        return false;
      }
    });
    assert.deepEqual(JSON.parse(await readFile(marker, "utf8")), {
      args: ["dev:web"],
      enabled: "true",
    });
    await waitFor(async () => {
      const log = await readFile(started[0].log, "utf8");

      return log.includes("sample stdout") && log.includes("sample stderr");
    });
    await stopProcesses(directory);
    assert.equal(isRunning(started[0].pid), false);
  } finally {
    for (const { pid } of started) {
      await forceStop(pid);
    }

    await removeDirectory(directory);
  }
});

test("foreground observability commands pass the correct service environment", async () => {
  const directory = await temporaryDirectory();
  const code =
    "console.log(JSON.stringify({ args: process.argv.slice(2), enabled: process.env.VITE_OBSERVABILITY_ENABLED, endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }));";

  try {
    const env = { ...process.env, ...(await pnpmFixture(directory, code)) };
    const cases = [
      {
        service: "server",
        expected: { args: ["dev:server"], endpoint: "http://127.0.0.1:4318" },
      },
      { service: "web", expected: { args: ["dev:web"], enabled: "true" } },
    ];

    delete env.VITE_OBSERVABILITY_ENABLED;
    delete env.OTEL_EXPORTER_OTLP_ENDPOINT;

    for (const { service, expected } of cases) {
      const result = await execFileAsync(
        process.execPath,
        [devScript, "run-observability", service],
        {
          env,
          windowsHide: true,
          timeout: 5000,
        },
      );

      assert.deepEqual(JSON.parse(result.stdout), expected);
    }
  } finally {
    await removeDirectory(directory);
  }
});

test(
  "Windows stop retains the journal when process-tree cleanup fails",
  {
    skip: process.platform !== "win32",
  },
  async () => {
    const directory = await temporaryDirectory();
    const journal = join(directory, "processes.json");
    const pathKey = Object.keys(process.env).find(
      (key) => key.toLowerCase() === "path",
    );
    const originalPath = process.env[pathKey];
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      },
    );

    try {
      await once(child, "spawn");
      child.unref();

      const records = [{ name: "sample", pid: child.pid }];

      await writeFile(journal, JSON.stringify(records));
      // A non-executable taskkill fixture makes the OS reject cleanup without killing the child.
      await writeFile(join(directory, "taskkill.exe"), "invalid executable");
      process.env[pathKey] = directory;

      await assert.rejects(stopProcesses(directory));
      assert.equal(isRunning(child.pid), true);
      assert.deepEqual(JSON.parse(await readFile(journal, "utf8")), records);
    } finally {
      process.env[pathKey] = originalPath;
      await forceStop(child.pid);
      await removeDirectory(directory);
    }
  },
);

test(
  "background launcher supports a standalone Windows pnpm executable",
  {
    skip: process.platform !== "win32",
  },
  async () => {
    const directory = await temporaryDirectory();
    const marker = join(directory, "ready.json");
    const script = join(directory, "executable-probe.mjs");
    const pathKey = Object.keys(process.env).find(
      (key) => key.toLowerCase() === "path",
    );
    let started = [];

    try {
      // A renamed Node executable exercises native executable lookup without installing pnpm.
      await copyFile(process.execPath, join(directory, "pnpm.exe"));
      await writeFile(
        script,
        [
          'import { writeFileSync } from "node:fs";',
          "writeFileSync(process.argv[2], JSON.stringify({ pid: process.pid, args: process.argv.slice(3) }));",
          "setInterval(() => {}, 1000);",
        ].join("\n"),
      );

      started = await launchProcesses(directory, [
        {
          name: "sample",
          command: "pnpm",
          args: [script, marker, "probe"],
          env: { [pathKey]: directory },
        },
      ]);

      await waitFor(async () => {
        try {
          await access(marker);

          return true;
        } catch {
          return false;
        }
      });

      const record = JSON.parse(await readFile(marker, "utf8"));

      assert.deepEqual(record.args, ["probe"]);
      await stopProcesses(directory);
      assert.equal(isRunning(record.pid), false);
    } finally {
      for (const { pid } of started) {
        await forceStop(pid);
      }

      await removeDirectory(directory);
    }
  },
);
