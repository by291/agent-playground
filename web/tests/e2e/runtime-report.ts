const slowTestBudgetMs = 10_000;
const totalSuiteBudgetMs = 120_000;
const slowestResultLimit = 10;

export interface CaseRuntime {
  project: string;
  file: string;
  title: string;
  status: string;
  durationMs: number;
  retry: number;
}

/** Aggregates measured case durations, including the setup cost of runtime skips. */
export function summarizeRuntime(cases: CaseRuntime[], shardTotal = 1) {
  const executed = cases.filter((entry) => entry.status !== "skipped");
  const groups = new Map<
    string,
    { project: string; file: string; count: number; durationMs: number }
  >();
  const warnings: string[] = [];
  let totalTestMs = 0;

  // A runtime skip can follow expensive setup; its measured time is still a cost.
  for (const entry of cases) {
    const key = `${entry.project}/${entry.file}`;
    const group = groups.get(key) ?? {
      project: entry.project,
      file: entry.file,
      count: 0,
      durationMs: 0,
    };

    group.count += 1;
    group.durationMs += entry.durationMs;
    groups.set(key, group);
    totalTestMs += entry.durationMs;

    if (entry.durationMs > slowTestBudgetMs) {
      warnings.push(
        `Review slow test: ${entry.project} / ${entry.title} (${Math.round(entry.durationMs)} ms; budget ${slowTestBudgetMs} ms).`,
      );
    }
  }

  const totalBudgetMs = totalSuiteBudgetMs / shardTotal;

  if (totalTestMs > totalBudgetMs) {
    warnings.push(
      `Review aggregate test cost: ${Math.round(totalTestMs)} ms; budget ${Math.round(totalBudgetMs)} ms for this shard.`,
    );
  }

  return {
    executed: executed.length,
    skipped: cases.length - executed.length,
    totalTestMs,
    groups: [...groups.values()].sort(
      (first, second) => second.durationMs - first.durationMs,
    ),
    warnings,
    slowest: [...cases]
      .sort((first, second) => second.durationMs - first.durationMs)
      .slice(0, slowestResultLimit),
  };
}
