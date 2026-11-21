#!/usr/bin/env node
/**
 * Closed-loop load test for the running CafeFlow stack.
 *
 * 150 virtual users, each with one in-flight request at a time. Every fifth
 * request is a real staff order write (20%); the other four are reads. Writes
 * use an authenticated staff session because the anonymous customer endpoint
 * deliberately limits one IP to 40 orders / 10 minutes, which would hide the
 * database behaviour behind 429s. The report says this explicitly.
 *
 *   LOADTEST_ADMIN_PASSWORD=... node scripts/loadtest/run.mjs
 *
 * Env:
 *   LOADTEST_BASE_URL       default http://127.0.0.1:18080
 *   LOADTEST_QR_TOKEN       table QR token (required)
 *   LOADTEST_ADMIN_USERNAME default admin
 *   LOADTEST_ADMIN_PASSWORD required
 *   LOADTEST_VUS            default 150
 *   LOADTEST_THINK_MS       default 1000
 *   LOADTEST_WARMUP_MS      default 10000
 *   LOADTEST_DURATION_MS    default 60000
 *   LOADTEST_LABEL          default stress
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

const BASE = (process.env.LOADTEST_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const VUS = Number(process.env.LOADTEST_VUS ?? 150);
const THINK_MS = Number(process.env.LOADTEST_THINK_MS ?? 1_000);
const WARMUP_MS = Number(process.env.LOADTEST_WARMUP_MS ?? 10_000);
const DURATION_MS = Number(process.env.LOADTEST_DURATION_MS ?? 60_000);
const LABEL = process.env.LOADTEST_LABEL ?? 'stress';
const ADMIN_USERNAME = process.env.LOADTEST_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.LOADTEST_ADMIN_PASSWORD;
const QR_TOKEN = process.env.LOADTEST_QR_TOKEN;

if (!ADMIN_PASSWORD) throw new Error('LOADTEST_ADMIN_PASSWORD is required');
if (!QR_TOKEN) throw new Error('LOADTEST_QR_TOKEN is required');
if (!Number.isFinite(VUS) || VUS < 1) throw new Error('LOADTEST_VUS must be a positive number');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} -> ${response.status}: ${text.slice(0, 500)}`);
  }
  return { response, body };
}

function readCookie(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  return values.map((value) => value.split(';', 1)[0]).join('; ');
}

/* ------------------------------- bootstrap ------------------------------- */

const menu = await jsonRequest(`/api/v1/public/menu?qr=${encodeURIComponent(QR_TOKEN)}`);
const products = menu.body.categories
  .flatMap((category) => category.products)
  .filter((product) => product.isAvailable);
if (products.length === 0) throw new Error('no available product in the seeded menu');

const product =
  products.find((candidate) => candidate.nameFa === 'اسپرسو') ??
  products.find((candidate) => candidate.optionGroups.every((group) => !group.isRequired)) ??
  products[0];
const requiredOptions = product.optionGroups
  .filter((group) => group.isRequired || group.minSelect > 0)
  .flatMap((group) => group.options.slice(0, Math.max(group.minSelect, 1)).map((option) => option.id));
const item = {
  productId: product.id,
  quantity: 1,
  optionIds: requiredOptions,
  extraIds: [],
};

const adminLogin = await jsonRequest('/api/v1/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
});
const adminCookie = readCookie(adminLogin.response);
if (!adminCookie) throw new Error('admin login did not return a session cookie');

// The menu endpoint touches customer_devices.last_seen_at for a known device.
// Sending the real cookie keeps the test realistic and avoids inserting a new
// device row on every menu request.
const deviceCookie = readCookie(menu.response);
if (!deviceCookie.includes('cafe_device=')) throw new Error('menu did not return a cafe_device cookie');

// One public order gives the status-reader a real code + token. Only one is
// created here, so the per-IP anonymous order limit is not involved.
const publicOrder = await jsonRequest('/api/v1/public/orders', {
  method: 'POST',
  body: JSON.stringify({
    qrToken: QR_TOKEN,
    clientRequestId: randomUUID(),
    items: [item],
  }),
});
const statusCode = publicOrder.body.code;
const statusToken = publicOrder.body.statusToken;
if (!statusCode || !statusToken) throw new Error('could not create the status-reader order');

console.log(
  JSON.stringify({
    phase: 'bootstrap',
    base: BASE,
    vus: VUS,
    thinkMs: THINK_MS,
    warmupMs: WARMUP_MS,
    durationMs: DURATION_MS,
    product: product.nameFa,
    statusCode,
  }),
);

/* --------------------------------- tasks --------------------------------- */

const authHeaders = { cookie: adminCookie };
const reads = [
  {
    name: 'menu',
    weight: 35,
    run: () =>
      fetch(`${BASE}/api/v1/public/menu?qr=${encodeURIComponent(QR_TOKEN)}`, {
        headers: { cookie: deviceCookie },
        signal: AbortSignal.timeout(20_000),
      }),
  },
  {
    name: 'order-status',
    weight: 25,
    run: () =>
      fetch(`${BASE}/api/v1/public/orders/${encodeURIComponent(statusCode)}?token=${encodeURIComponent(statusToken)}`, {
        signal: AbortSignal.timeout(20_000),
      }),
  },
  {
    name: 'orders-list',
    weight: 20,
    run: () =>
      fetch(`${BASE}/api/v1/orders?scope=active&pageSize=20`, {
        headers: authHeaders,
        signal: AbortSignal.timeout(20_000),
      }),
  },
  {
    name: 'prep-queue',
    weight: 10,
    run: () =>
      fetch(`${BASE}/api/v1/prep/queue`, {
        headers: authHeaders,
        signal: AbortSignal.timeout(20_000),
      }),
  },
  {
    name: 'dashboard',
    weight: 10,
    run: () =>
      fetch(`${BASE}/api/v1/dashboard/overview`, {
        headers: authHeaders,
        signal: AbortSignal.timeout(20_000),
      }),
  },
];

let requestSequence = 0;
let readSequence = 0;
let cleanupRequests = 0;

function pickRead() {
  const point = readSequence++ % reads.reduce((sum, route) => sum + route.weight, 0);
  let cursor = 0;
  for (const route of reads) {
    cursor += route.weight;
    if (point < cursor) return route;
  }
  return reads[reads.length - 1];
}

async function requestWrite() {
  const created = await fetch(`${BASE}/api/v1/orders`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      tableId: null,
      items: [item],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await created.text();
  if (!created.ok) return { status: created.status, error: `HTTP ${created.status}` };

  // Keep the test in steady state: an order that is never closed would grow the
  // active-order/prep queue artificially and make later reads look worse than a
  // real café where staff keep clearing the queue.
  let id;
  try {
    id = JSON.parse(text).id;
  } catch {
    return { status: created.status, error: 'create response was not JSON' };
  }
  if (!id) return { status: created.status, error: 'create response has no order id' };

  cleanupRequests += 1;
  const cancelled = await fetch(`${BASE}/api/v1/orders/${encodeURIComponent(id)}/transition`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ to: 'cancelled', reason: 'loadtest' }),
    signal: AbortSignal.timeout(20_000),
  });
  await cancelled.arrayBuffer();
  return {
    status: created.status,
    error: cancelled.ok ? null : `cancel HTTP ${cancelled.status}`,
  };
}

const samples = [];
const byRoute = new Map();
const statuses = new Map();
const errorSamples = [];
const measureStart = Date.now() + WARMUP_MS;
const finishAt = measureStart + DURATION_MS;
const runStartedAt = new Date().toISOString();

function record(route, started, status, error) {
  const latencyMs = performance.now() - started;
  if (Date.now() >= measureStart) {
    samples.push({ route, latencyMs, status, error: error ?? null });
    if (!byRoute.has(route)) byRoute.set(route, []);
    byRoute.get(route).push(latencyMs);
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
    if (error && errorSamples.length < 10) errorSamples.push({ route, status, error });
  }
}

async function vu(workerId) {
  let sequence = workerId;
  await sleep(Math.random() * Math.max(THINK_MS, 1));

  while (Date.now() < finishAt) {
    const route = sequence++ % 5 === 0 ? 'write-order' : 'read';
    const read = route === 'read' ? pickRead() : null;
    const started = performance.now();
    let status = 0;
    let error = null;

    try {
      if (route === 'write-order') {
        const result = await requestWrite();
        status = result.status;
        error = result.error;
      } else {
        const response = await read.run();
        status = response.status;
        await response.arrayBuffer();
        if (!response.ok) error = `HTTP ${status}`;
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }

    record(route === 'write-order' ? 'write-order' : read.name, started, status, error);
    const jitter = THINK_MS * (0.85 + Math.random() * 0.3);
    await sleep(jitter);
  }
}

const progress = setInterval(() => {
  if (Date.now() < measureStart) return;
  const elapsed = Math.max((Date.now() - measureStart) / 1000, 1);
  console.log(
    JSON.stringify({
      phase: 'progress',
      elapsedSec: Number(elapsed.toFixed(1)),
      requests: samples.length,
      rps: Number((samples.length / elapsed).toFixed(2)),
      errors: samples.filter((sample) => sample.error).length,
    }),
  );
}, 5_000);

const generatorCpuStart = process.cpuUsage();
const generatorWallStart = Date.now();
await Promise.all(Array.from({ length: VUS }, (_, index) => vu(index)));
clearInterval(progress);
const generatorCpu = process.cpuUsage(generatorCpuStart);
const generatorWallSec = Math.max((Date.now() - generatorWallStart) / 1000, 0.001);
const generatorCpuPercent = Number((((generatorCpu.user + generatorCpu.system) / 1_000_000 / generatorWallSec) * 100).toFixed(1));

const wallClockSec = Math.max((Date.now() - measureStart) / 1000, 0.001);
// Workers may sleep through the deadline; that idle tail is not request time.
const durationSec = DURATION_MS / 1000;
const finishedAtMs = measureStart + DURATION_MS;
const finishedAt = new Date(finishedAtMs).toISOString();

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[index].toFixed(2));
}

const allLatencies = samples.map((sample) => sample.latencyMs);
const errors = samples.filter((sample) => sample.error);
const summary = {
  label: LABEL,
  base: BASE,
  config: {
    vus: VUS,
    thinkMs: THINK_MS,
    warmupMs: WARMUP_MS,
    durationMs: DURATION_MS,
    writeMode: 'authenticated staff order (anonymous order limit bypassed for DB measurement)',
    product: product.nameFa,
  },
  runStartedAt,
  startedAt: new Date(measureStart).toISOString(),
  finishedAt,
  startedAtMs: measureStart,
  finishedAtMs,
  durationSec: Number(durationSec.toFixed(2)),
  wallClockSec: Number(wallClockSec.toFixed(2)),
  requests: samples.length,
  rps: Number((samples.length / durationSec).toFixed(2)),
  cleanupRequests,
  httpRequests: samples.length + cleanupRequests,
  httpRps: Number(((samples.length + cleanupRequests) / durationSec).toFixed(2)),
  generatorCpuPercent,
  errors: errors.length,
  errorRate: samples.length === 0 ? 1 : Number((errors.length / samples.length).toFixed(4)),
  statusCounts: Object.fromEntries([...statuses.entries()].sort(([a], [b]) => a - b)),
  latencyMs: {
    p50: percentile(allLatencies, 50),
    p95: percentile(allLatencies, 95),
    p99: percentile(allLatencies, 99),
    max: allLatencies.length > 0 ? Number(Math.max(...allLatencies).toFixed(2)) : null,
  },
  byRoute: Object.fromEntries(
    [...byRoute.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([route, values]) => [
        route,
        {
          count: values.length,
          p50: percentile(values, 50),
          p95: percentile(values, 95),
          p99: percentile(values, 99),
          max: Number(Math.max(...values).toFixed(2)),
        },
      ]),
  ),
  errorSamples,
};

mkdirSync('test-artifacts', { recursive: true });
const output = `test-artifacts/loadtest-${LABEL}.json`;
writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({ phase: 'result', output, ...summary }, null, 2));
