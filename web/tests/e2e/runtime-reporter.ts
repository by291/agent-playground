import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { summarizeRuntime, type CaseRuntime } from "./runtime-report";

function seconds(milliseconds: number) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function cell(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export default class RuntimeReporter implements Reporter {
  private config!: FullConfig;
  private cases: CaseRuntime[] = [];

  onBegin(config: FullConfig) {
    this.config = config;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.cases.push({
      project: test.parent.project()?.name ?? "unknown",
      file: relative(this.config.rootDir, test.location.file),
      title: test.titlePath().slice(2).join(" / "),
      status: result.status,
      durationMs: result.duration,
      retry: result.retry,
    });
  }

  async onEnd(result: FullResult) {
    const summary = summarizeRuntime(this.cases, this.config.shard?.total ?? 1);
    const report = {
      status: result.status,
      startedAt: result.startTime.toISOString(),
      elapsedMs: result.duration,
      shard: this.config.shard,
      reference: { commit: "1d0728d", ciCases: 35, ciTotalTestMs: 206_600 },
      ...summary,
      cases: this.cases,
    };
    const markdown = [
      "## Browser test runtime",
      "",
      `Result: ${result.status}. ${summary.executed} executed, ${summary.skipped} skipped. Elapsed: ${seconds(result.duration)}; sum of test durations: ${seconds(summary.totalTestMs)}.`,
      "",
      "| Project / group | Results | Test time |",
      "| --- | ---: | ---: |",
      ...summary.groups.map(
        (group) =>
          `| ${cell(group.project)} / ${cell(group.file)} | ${group.count} | ${seconds(group.durationMs)} |`,
      ),
      "",
      "### Slowest tests",
      "",
      "| Test | Status | Time |",
      "| --- | --- | ---: |",
      ...summary.slowest.map(
        (entry) =>
          `| ${cell(entry.project)} / ${cell(entry.title)} | ${entry.status} | ${seconds(entry.durationMs)} |`,
      ),
      "",
      "Cost review budgets: 10s per test, 120s aggregate divided by shard count. Advisory; failures retain their original result. Filtered/repeated runs are recorded as run, not extrapolated to a complete suite.",
      "",
      ...summary.warnings.map((warning) => `- ${warning}`),
      "",
    ].join("\n");
    const output = this.config.projects[0]!.outputDir;

    await mkdir(output, { recursive: true });
    await writeFile(
      join(output, "runtime.json"),
      JSON.stringify(report, null, 2),
    );
    await writeFile(join(output, "runtime.md"), markdown);

    for (const warning of summary.warnings) {
      console.warn(warning);
    }
  }
}
