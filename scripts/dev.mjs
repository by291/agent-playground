import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const runtimeDirectory = join(projectRoot, ".dev");

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

export async function stopProcesses(directory) {
  const processes = await readProcesses(directory);

  for (const { pid } of processes) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") {
        throw error;
      }
    }
  }

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
      const child = spawn(command, args, {
        cwd: projectRoot,
        detached: true,
        env: { ...process.env, ...env },
        stdio: ["ignore", descriptor, descriptor],
      });
      closeSync(descriptor);

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
    await stopProcesses(directory);
    throw error;
  }

  return started;
}

async function main() {
  const action = process.argv[2];

  if (action === "stop") {
    const stopped = await stopProcesses(runtimeDirectory);
    console.log(
      stopped.length > 0
        ? "Stopped development apps."
        : "No development apps are running.",
    );
    return;
  }

  if (action !== "start" && action !== "start-observability") {
    throw new Error("Expected start, start-observability, or stop.");
  }

  const observability = action === "start-observability";
  const commands = [
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
