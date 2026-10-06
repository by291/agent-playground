import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function temporaryDirectory() {
  return mkdtemp(join(tmpdir(), "agent-playground-tools-"));
}

export async function removeDirectory(directory) {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("agent-playground-tools-"));

  await rm(directory, { recursive: true, force: true });
}

export function isRunning(pid) {
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

export async function waitFor(check) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await check()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.fail("Timed out waiting for the test process.");
}

export async function forceStop(pid) {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    if (!isRunning(pid)) {
      return;
    }

    await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      timeout: 5000,
    });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") {
        throw error;
      }
    }
  }

  await waitFor(() => !isRunning(pid));
}

export async function pnpmFixture(directory, code) {
  if (process.platform === "win32") {
    const script = join(directory, "pnpm probe.mjs");

    await writeFile(script, code);
    await writeFile(
      join(directory, "pnpm.cmd"),
      `@"${process.execPath}" "${script}" %*\r\n`,
    );
  } else {
    const script = join(directory, "pnpm");

    await writeFile(script, "#!/usr/bin/env node\n" + code);
    await chmod(script, 0o755);
  }

  const pathKey =
    Object.keys(process.env).find((key) => key.toLowerCase() === "path") ??
    "PATH";

  return { [pathKey]: directory + delimiter + (process.env[pathKey] ?? "") };
}
