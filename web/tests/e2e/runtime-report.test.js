import { expect, test } from "vitest";
import { summarizeRuntime } from "./runtime-report";

function entry(overrides = {}) {
  return {
    project: "production",
    file: "conversation.spec.ts",
    title: "restores a discussion",
    status: "passed",
    durationMs: 1000,
    retry: 0,
    ...overrides,
  };
}

test("runtime costs count failures and repeat attempts, distinguish skips and separate projects", () => {
  const report = summarizeRuntime([
    entry(),
    entry({ status: "failed", durationMs: 3000 }),
    entry({ durationMs: 500, retry: 1 }),
    entry({ project: "development", durationMs: 1500 }),
    entry({ status: "skipped", durationMs: 0 }),
  ]);

  expect(report.executed).toBe(4);
  expect(report.skipped).toBe(1);
  expect(report.totalTestMs).toBe(6000);
  expect(report.groups).toEqual([
    {
      project: "production",
      file: "conversation.spec.ts",
      count: 4,
      durationMs: 4500,
    },
    {
      project: "development",
      file: "conversation.spec.ts",
      count: 1,
      durationMs: 1500,
    },
  ]);
  expect(report.slowest[0]).toMatchObject({
    status: "failed",
    durationMs: 3000,
  });
});

test("cost budgets flag individual slow tests and scale the aggregate budget for shards", () => {
  const cases = Array.from({ length: 10 }, () => entry({ durationMs: 7000 }));

  expect(summarizeRuntime(cases).warnings).toEqual([]);
  expect(summarizeRuntime(cases, 2).warnings).toHaveLength(1);
  expect(
    summarizeRuntime([entry({ durationMs: 11000 })]).warnings[0],
  ).toContain("restores a discussion");
  expect(summarizeRuntime([]).warnings).toEqual([]);
});

test("runtime skips retain setup and execution costs in groups, slow tests and budgets", () => {
  const report = summarizeRuntime([
    entry({ status: "skipped", durationMs: 15000 }),
    entry({ status: "skipped", durationMs: 0 }),
  ]);

  expect(report.executed).toBe(0);
  expect(report.skipped).toBe(2);
  expect(report.totalTestMs).toBe(15000);
  expect(report.groups).toEqual([
    {
      project: "production",
      file: "conversation.spec.ts",
      count: 2,
      durationMs: 15000,
    },
  ]);
  expect(report.slowest[0]).toMatchObject({
    status: "skipped",
    durationMs: 15000,
  });
  expect(report.warnings[0]).toContain("restores a discussion");
});
