/**
 * Load-test-only preload for the API container.
 *
 * It is mounted into the untouched production image and started with
 * `node --import /app/loadtest/server-event-loop.mjs dist/main.js`.
 * Every second it prints one JSON line with the real event-loop delay
 * histogram, CPU usage and RSS. The load-test runner filters these lines to the
 * measurement window.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';

const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

let previousCpu = process.cpuUsage();
let previousAt = process.hrtime.bigint();

const timer = setInterval(() => {
  const now = process.hrtime.bigint();
  const cpu = process.cpuUsage(previousCpu);
  const elapsedMicros = Number(now - previousAt) / 1_000;
  previousCpu = process.cpuUsage();
  previousAt = now;

  const memory = process.memoryUsage();
  const record = {
    kind: 'loadtest-event-loop',
    t: Date.now(),
    p50Ms: histogram.percentile(50) / 1e6,
    p95Ms: histogram.percentile(95) / 1e6,
    p99Ms: histogram.percentile(99) / 1e6,
    maxMs: histogram.max / 1e6,
    cpuPercent: elapsedMicros > 0 ? ((cpu.user + cpu.system) / elapsedMicros) * 100 : 0,
    rssMb: memory.rss / 1024 / 1024,
    heapUsedMb: memory.heapUsed / 1024 / 1024,
  };

  // One line per second; Docker captures stdout with timestamps.
  console.log(JSON.stringify(record));
  histogram.reset();
}, 1_000);

timer.unref();

process.on('SIGTERM', () => {
  timer.unref();
  histogram.disable();
});
