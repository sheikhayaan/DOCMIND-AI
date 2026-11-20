import 'server-only';
import { cpus } from 'node:os';
import { monitorEventLoopDelay, performance, type IntervalHistogram } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import type { NodeTelemetry } from '../admin-types';

type RuntimeState = { histogram: IntervalHistogram; cpu: NodeJS.CpuUsage | null; at: number };
const runtimeGlobal = globalThis as typeof globalThis & { docmindRuntimeTelemetry?: RuntimeState };

// Samples the actual Next.js Node process using built-in APIs, separate from the Python worker.
export function getRuntimeSnapshot(): NodeTelemetry {
  if (!runtimeGlobal.docmindRuntimeTelemetry) {
    const histogram = monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();
    runtimeGlobal.docmindRuntimeTelemetry = { histogram, cpu: null, at: performance.now() };
  }
  const state = runtimeGlobal.docmindRuntimeTelemetry;
  const now = performance.now();
  const current = process.cpuUsage();
  const elapsed = now - state.at;
  const percent = state.cpu && elapsed > 0
    ? ((current.user - state.cpu.user + current.system - state.cpu.system) / (elapsed * 1000 * Math.max(1, cpus().length))) * 100
    : null;
  state.cpu = current;
  state.at = now;
  const lag = state.histogram.mean / 1_000_000;
  state.histogram.reset();
  const memory = process.memoryUsage();
  return {
    runtime: process.version,
    scope: 'This Next.js Node instance only; serverless instances may rotate',
    processId: process.pid,
    timestamp: new Date().toISOString(),
    cpuPercent: percent === null ? null : Math.round(Math.max(0, Math.min(100, percent)) * 100) / 100,
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    heapLimitBytes: getHeapStatistics().heap_size_limit,
    eventLoopLagMs: Number.isFinite(lag) ? Math.round(lag * 100) / 100 : null,
  };
}
