/**
 * Wall-clock budgets that hold on a shared CI runner.
 *
 * One `performance.now()` pair is one draw from a noisy machine: a GC pause, the
 * v8 coverage flush or a neighbouring worker taking the core lands on whichever
 * sample it hits, and the budget fails for a reason that is not the code (master
 * 02/11: 203 ms against 200; PR #31: one wall 21 ms against a whole storey 19 ms).
 * Several samples read through a robust statistic keep the budget a statement
 * about the code, and a regression that is real moves every sample, so it still
 * fails.
 */

/** Runs `run` `samples` times and returns each run's milliseconds, fastest first. */
export function sampleMs(run: () => void, samples: number): number[] {
  const times: number[] = [];

  for (let sample = 0; sample < samples; sample += 1) {
    const startedAt = performance.now();
    run();
    times.push(performance.now() - startedAt);
  }

  return times.sort((a, b) => a - b);
}

/** The middle of an ascending list — what a typical run costs, whatever one stall did. */
export function medianOf(sorted: readonly number[]): number {
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

/** Median milliseconds of `samples` runs of `run`. */
export function medianMs(run: () => void, samples = 5): number {
  return medianOf(sampleMs(run, samples));
}
