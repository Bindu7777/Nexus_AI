import type { Distribution, Sample, Summary } from "./types";

export function roundMs(value: number) {
  return Math.round(value * 100) / 100;
}

export function quantile(sorted: number[], p: number) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(p * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

export function distribution(values: number[]): Distribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    min: roundMs(sorted[0]),
    p50: roundMs(quantile(sorted, 0.5) ?? sorted[0]),
    p95: roundMs(quantile(sorted, 0.95) ?? sorted[sorted.length - 1]),
    max: roundMs(sorted[sorted.length - 1]),
    mean: roundMs(sum / sorted.length),
  };
}

export function summarize(samples: Sample[]): Summary {
  const latencies = samples.map((sample) => sample.latencyMs);
  const lockWaits = samples
    .map((sample) => sample.lockWaitMs)
    .filter((value): value is number => value != null);
  const lockHolds = samples
    .map((sample) => sample.lockHoldMs)
    .filter((value): value is number => value != null);
  const queues = samples
    .map((sample) => sample.queueDepth)
    .filter((value): value is number => value != null);

  return {
    requests: samples.length,
    success: samples.filter((sample) => sample.status === 200).length,
    errors: samples.filter((sample) => sample.status !== 200).length,
    timeouts: samples.filter((sample) => sample.error === "timeout").length,
    latencyMs: distribution(latencies),
    lockWaitMs: distribution(lockWaits),
    lockHoldMs: distribution(lockHolds),
    maxQueueDepth: queues.length === 0 ? null : Math.max(...queues),
  };
}

export function describeSummary(summary: Summary) {
  const p95 = summary.latencyMs ? `${summary.latencyMs.p95} ms p95 client` : "no client latency";
  const wait = summary.lockWaitMs ? `${summary.lockWaitMs.mean} ms mean lock wait` : "no lock-wait samples";
  const queue = summary.maxQueueDepth == null ? "no queue observation" : `max lock waiters ${summary.maxQueueDepth}`;
  return `${summary.success}/${summary.requests} succeeded, ${summary.errors} errors, ${p95}, ${wait}, ${queue}.`;
}
