#!/usr/bin/env node
/**
 * CafeFlow print bridge.
 *
 * The API never talks to a printer directly: it stores receipt text in the
 * `print_jobs` queue. This small worker polls that queue with a dedicated staff
 * session, writes each receipt to a text file (or appends to a spool file), and
 * reports back so the queue shows printed/failed.
 *
 * Usage (from the repository root, API already running):
 *   PRINT_BRIDGE_USERNAME=barista PRINT_BRIDGE_PASSWORD=... node scripts/print-bridge.mjs
 *
 * Optional:
 *   API_BASE=http://127.0.0.1:3000/api/v1
 *   PRINT_OUTPUT_DIR=./print-output
 *   PRINT_INTERVAL_MS=3000
 *
 * The account only needs `orders.read`. The text file can be fed to any
 * hardware driver (CUPS, lpr, a serial/ESC-POS adapter); this script
 * deliberately contains no device-specific code.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const API_BASE = process.env.API_BASE ?? 'http://127.0.0.1:3000/api/v1';
const USERNAME = process.env.PRINT_BRIDGE_USERNAME;
const PASSWORD = process.env.PRINT_BRIDGE_PASSWORD;
const OUTPUT_DIR = resolve(process.env.PRINT_OUTPUT_DIR ?? './print-output');
const INTERVAL_MS = Number(process.env.PRINT_INTERVAL_MS ?? 3000);
const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'cafe_session';

if (!USERNAME || !PASSWORD) {
  console.error('PRINT_BRIDGE_USERNAME و PRINT_BRIDGE_PASSWORD را تنظیم کنید.');
  process.exit(1);
}

let cookie = '';
let running = true;

async function call(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers ?? {}),
    },
  });

  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    const match = new RegExp(`${COOKIE_NAME}=([^;]+)`).exec(setCookie);
    if (match) cookie = `${COOKIE_NAME}=${match[1]}`;
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = payload?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function safeFileName(value) {
  return String(value ?? 'job').replace(/[^\w.-]+/g, '_');
}

async function login() {
  await call('/auth/login', { method: 'POST', body: JSON.stringify({ username: USERNAME, password: PASSWORD }) });
  console.log('print-bridge: logged in as', USERNAME);
}

async function tick() {
  const { items } = await call('/print/jobs?status=queued');
  for (const job of items) {
    const file = join(OUTPUT_DIR, `${safeFileName(job.orderCode)}-${job.id.slice(0, 8)}.txt`);
    try {
      mkdirSync(OUTPUT_DIR, { recursive: true });
      writeFileSync(file, `${job.receipt.join('\n')}\n`, 'utf8');
      await call(`/print/jobs/${job.id}/printed`, { method: 'POST', body: '{}' });
      console.log(`print-bridge: printed ${job.orderCode ?? job.id} -> ${file}`);
    } catch (error) {
      console.error(`print-bridge: failed ${job.id}:`, error.message);
      try {
        await call(`/print/jobs/${job.id}/failed`, {
          method: 'POST',
          body: JSON.stringify({ error: String(error.message).slice(0, 180) }),
        });
      } catch (reportError) {
        console.error('print-bridge: could not report failure:', reportError.message);
      }
    }
  }
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  await login();
  console.log(`print-bridge: polling ${API_BASE} every ${INTERVAL_MS}ms, output ${OUTPUT_DIR}`);

  while (running) {
    try {
      await tick();
    } catch (error) {
      if (error.message.includes('401') || error.message.includes('نشست')) {
        try {
          await login();
        } catch (loginError) {
          console.error('print-bridge: re-login failed:', loginError.message);
        }
      } else {
        console.error('print-bridge:', error.message);
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, INTERVAL_MS));
  }
}

process.on('SIGINT', () => {
  running = false;
  console.log('\nprint-bridge: stopping');
  process.exit(0);
});

main().catch((error) => {
  console.error('print-bridge fatal:', error);
  process.exit(1);
});
