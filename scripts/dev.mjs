import { execFile, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const runtimeDirectory = join(projectRoot, ".dev");
const execFileAsync = promisify(execFile);

function spawnCommand(command, args, options) {
  if (process.platform === "win32" && command === "pnpm") {
    if (options.detached) {
      // A detached Node host keeps CMD's output connected to the managed log files.
      return spawn(
        process.execPath,
        [fileURLToPath(import.meta.url), "run-pnpm", ...args],
        { ...options, windowsHide: true },
      );
    }

    // CMD resolves both standalone pnpm.exe installations and package-manager shims.
    return spawn(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", "pnpm", ...args],
      {
        ...options,
        windowsHide: true,
      },
    );
  }

  return spawn(command, args, { ...options, windowsHide: true });
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    if (error.code === "ESRCH") {
      return false;
    }

    throw error;
  }
}

async function readProcesses(directory) {
  try {
    return JSON.parse(
      await readFile(join(directory, "processes.json"), "utf8"),
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function stopProcessTree(pid) {
  if (process.platform === "win32" && !isRunning(pid)) {
    return;
  }

  try {
    if (process.platform === "win32") {
      // Windows has no POSIX process groups. Include all descendants of the launcher.
      await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 10000,
      });
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch (error) {
    if (process.platform !== "win32" && error.code !== "ESRCH") {
      throw error;
    }

    if (isRunning(pid)) {
      throw error;
    }
  }

  const deadline = Date.now() + 5000;

  while (isRunning(pid)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Development process ${pid} did not stop; its journal has been retained.`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function stopProcessTrees(processes) {
  for (const { pid } of processes) {
    await stopProcessTree(pid);
  }
}

export async function stopProcesses(directory) {
  const processes = await readProcesses(directory);

  await stopProcessTrees(processes);

  await rm(join(directory, "processes.json"), { force: true });

  return processes;
}

export async function launchProcesses(directory, commands, mode = "standard") {
  const existing = await readProcesses(directory);

  if (existing.length > 0 && existing.every(({ pid }) => isRunning(pid))) {
    if (existing[0].mode !== mode) {
      throw new Error(
        "Development apps are already running in another mode. Run make dev-stop first.",
      );
    }

    return existing;
  }

  if (existing.length > 0) {
    await stopProcesses(directory);
  }

  await mkdir(directory, { recursive: true });
  const started = [];

  try {
    for (const { name, command, args, env } of commands) {
      const log = join(directory, `${name}.log`);
      const descriptor = openSync(log, "a");
      let child;

      try {
        child = spawnCommand(command, args, {
          cwd: projectRoot,
          detached: true,
          env: { ...process.env, ...env },
          stdio: ["ignore", descriptor, descriptor],
        });
      } finally {
        closeSync(descriptor);
      }

      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });

      child.unref();
      started.push({ name, pid: child.pid, log, mode });
      await writeFile(
        join(directory, "processes.json"),
        JSON.stringify(started, null, 2),
      );
    }
  } catch (error) {
    try {
      // The latest child may not have reached the journal if persistence failed.
      await stopProcessTrees(started);
      await rm(join(directory, "processes.json"), { force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Development startup and process cleanup failed.",
      );
    }

    throw error;
  }

  return started;
}

function developmentCommands(observability) {
  return [
    {
      name: "agent",
      command: "uv",
      args: ["run", "agent"],
      env: observability
        ? {
            HOST: "0.0.0.0",
            OTEL_SERVICE_NAME: "agent-playground-agent",
            OTEL_TARGETS: "GENERIC",
            OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318/v1/traces",
            ENABLE_PROMETHEUS_METRICS: "true",
          }
        : {},
    },
    {
      name: "server",
      command: "pnpm",
      args: ["dev:server"],
      env: observability
        ? { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318" }
        : {},
    },
    {
      name: "web",
      command: "pnpm",
      args: ["dev:web"],
      env: observability ? { VITE_OBSERVABILITY_ENABLED: "true" } : {},
    },
  ];
}

async function runForeground({ command, args, env }) {
  const child = spawnCommand(command, args, {
    cwd: projectRoot,
    detached: process.platform !== "win32",
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  let stopping = false;

  // Foreground commands also own their descendants when the terminal sends a signal.
  const stop = async () => {
    if (stopping || !child.pid) {
      return;
    }

    stopping = true;

    try {
      await stopProcessTree(child.pid);
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      stopping = false;
    }
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

async function main() {
  const action = process.argv[2];

  if (action === "run-pnpm") {
    await runForeground({
      command: "pnpm",
      args: process.argv.slice(3),
      env: {},
    });

    return;
  }

  if (action === "stop") {
    const stopped = await stopProcesses(runtimeDirectory);

    console.log(
      stopped.length > 0
        ? "Stopped development apps."
        : "No development apps are running.",
    );

    return;
  }

  if (action === "run-observability") {
    const service = developmentCommands(true).find(
      ({ name }) => name === process.argv[3],
    );

    if (!service) {
      throw new Error(
        "Expected an observability service: agent, server, or web.",
      );
    }

    await runForeground(service);

    return;
  }

  if (action !== "start" && action !== "start-observability") {
    throw new Error(
      "Expected start, start-observability, stop, or run-observability <service>.",
    );
  }

  const observability = action === "start-observability";
  const commands = developmentCommands(observability);

  const started = await launchProcesses(
    runtimeDirectory,
    commands,
    observability ? "observability" : "standard",
  );

  for (const { name, pid, log } of started) {
    console.log(`${name}: pid ${pid}, log ${log}`);
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
