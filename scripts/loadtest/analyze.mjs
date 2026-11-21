#!/usr/bin/env node
/**
 * Combines the client result with the API container's event-loop/CPU log.
 *
 *   node scripts/loadtest/analyze.mjs \
 *     test-artifacts/loadtest-stress.json \
 *     test-artifacts/loadtest-stress-api.log
 */
import { readFileSync, writeFileSync } from 'node:fs';

const resultPath = process.argv[2];
const logPath = process.argv[3];
if (!resultPath || !logPath) {
  console.error('usage: node scripts/loadtest/analyze.mjs <result.json> <api.log>');
  process.exit(2);
}

const result = JSON.parse(readFileSync(resultPath, 'utf8'));
const log = readFileSync(logPath, 'utf8');
const lines = log.split(/\r?\n/);

const eventSamples = [];
for (const line of lines) {
  const start = line.indexOf('{"kind":"loadtest-event-loop"');
  if (start < 0) continue;
  try {
    const sample = JSON.parse(line.slice(start));
    if (sample.t >= result.startedAtMs && sample.t <= result.finishedAtMs) eventSamples.push(sample);
  } catch {
    // A truncated line at container shutdown is not a sample.
  }
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[index].toFixed(2));
}

const p95s = eventSamples.map((sample) => sample.p95Ms);
const p99s = eventSamples.map((sample) => sample.p99Ms);
const maxes = eventSamples.map((sample) => sample.maxMs);
const cpus = eventSamples.map((sample) => sample.cpuPercent);
const rss = eventSamples.map((sample) => sample.rssMb);
const worst = [...eventSamples]
  .sort((a, b) => b.p99Ms - a.p99Ms)
  .slice(0, 5)
  .map((sample) => ({
    at: new Date(sample.t).toISOString(),
    p95Ms: Number(sample.p95Ms.toFixed(2)),
    p99Ms: Number(sample.p99Ms.toFixed(2)),
    maxMs: Number(sample.maxMs.toFixed(2)),
    cpuPercent: Number(sample.cpuPercent.toFixed(1)),
  }));

const busyMatches = log.match(/SQLITE_BUSY|database is locked/gi) ?? [];
const unhandled = (log.match(/Unhandled error:/g) ?? []).length;

const analysis = {
  label: result.label,
  resultFile: resultPath,
  logFile: logPath,
  client: {
    requests: result.requests,
    rps: result.rps,
    cleanupRequests: result.cleanupRequests,
    httpRequests: result.httpRequests,
    httpRps: result.httpRps,
    generatorCpuPercent: result.generatorCpuPercent,
    errors: result.errors,
    errorRate: result.errorRate,
    p50: result.latencyMs.p50,
    p95: result.latencyMs.p95,
    p99: result.latencyMs.p99,
    max: result.latencyMs.max,
    statusCounts: result.statusCounts,
    byRoute: result.byRoute,
  },
  server: {
    samples: eventSamples.length,
    eventLoopMs: {
      p50OfPerSecondP95: percentile(p95s, 50),
      p95OfPerSecondP95: percentile(p95s, 95),
      p99OfPerSecondP95: percentile(p95s, 99),
      worstP99: p99s.length > 0 ? Number(Math.max(...p99s).toFixed(2)) : null,
      worstMax: maxes.length > 0 ? Number(Math.max(...maxes).toFixed(2)) : null,
    },
    cpuPercent: {
      average: cpus.length > 0 ? Number((cpus.reduce((sum, value) => sum + value, 0) / cpus.length).toFixed(1)) : null,
      peak: cpus.length > 0 ? Number(Math.max(...cpus).toFixed(1)) : null,
    },
    rssMb: {
      average: rss.length > 0 ? Number((rss.reduce((sum, value) => sum + value, 0) / rss.length).toFixed(1)) : null,
      peak: rss.length > 0 ? Number(Math.max(...rss).toFixed(1)) : null,
    },
    sqliteBusyCount: busyMatches.length,
    unhandledErrors: unhandled,
    worstSeconds: worst,
  },
};

const output = resultPath.replace(/\.json$/, '-analysis.json');
writeFileSync(output, `${JSON.stringify(analysis, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, ...analysis }, null, 2));
