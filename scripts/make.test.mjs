import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { removeDirectory, temporaryDirectory } from "./test-helpers.mjs";

const makefile = fileURLToPath(new URL("../Makefile", import.meta.url));
const hasMake =
  spawnSync("make", ["--version"], { windowsHide: true }).status === 0;

test(
  "Android Make targets invoke the native Gradle wrapper",
  { skip: !hasMake },
  async () => {
    const directory = await temporaryDirectory();

    try {
      await copyFile(makefile, join(directory, "Makefile"));
      await mkdir(join(directory, "android"));

      if (process.platform === "win32") {
        await writeFile(join(directory, "android/gradlew.bat"), "@echo %*\r\n");
      } else {
        const wrapper = join(directory, "android/gradlew");

        await writeFile(wrapper, '#!/bin/sh\nprintf "%s " "$@"\n');
        await chmod(wrapper, 0o755);
      }

      const cases = [
        { target: "android-format", expected: "-p android spotlessApply" },
        {
          target: "android-format-check",
          expected: "-p android spotlessCheck",
        },
        {
          target: "android-lint",
          expected: "-p android lintCheck",
        },
        { target: "android-check", expected: "-p android qualityCheck" },
      ];

      for (const { target, expected } of cases) {
        const result = spawnSync("make", ["--silent", target], {
          cwd: directory,
          encoding: "utf8",
          windowsHide: true,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), expected);
      }
    } finally {
      await removeDirectory(directory);
    }
  },
);
