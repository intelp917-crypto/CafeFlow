#!/usr/bin/env node
/**
 * Starts the whole CafeFlow workspace: builds the shared package, then runs the
 * Nest API (`tsx watch`) and the Vite web app together, with prefixed logs.
 * Ctrl+C stops both.
 */
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

const paint = (code) => (text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const label = {
  shared: paint('36')('[shared]'),
  api: paint('35')('[api] '),
  web: paint('32')('[web] '),
};

function runOnce(args, prefix) {
  const result = spawnSync(npm, args, { cwd: root, shell: isWindows, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`${prefix} failed with exit code ${result.status ?? 'unknown'}`);
    process.exit(result.status ?? 1);
  }
}

const children = new Set();
let stopping = false;

function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  if (isWindows) {
    // npm.cmd runs the real process below a shell, so the whole tree has to go.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) stop(child);
  process.exitCode = code;
  setTimeout(() => process.exit(code), 300).unref();
}

function start(prefix, args) {
  const child = spawn(npm, args, {
    cwd: root,
    shell: isWindows,
    detached: !isWindows,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? '1' : '0' },
  });

  children.add(child);

  const write = (stream) => (chunk) => {
    const lines = chunk.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line.trim().length > 0) stream.write(`${prefix} ${line}\n`);
    }
  };

  child.stdout.on('data', write(process.stdout));
  child.stderr.on('data', write(process.stderr));

  child.on('exit', (code) => {
    children.delete(child);
    if (stopping) return;
    console.error(`${prefix} exited (${code ?? 'signal'}); stopping the rest.`);
    shutdown(code ?? 1);
  });

  return child;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));

console.log(`${label.shared} building @cafeflow/shared`);
runOnce(['run', 'build:shared'], label.shared);
console.log(`${label.shared} building @cafeflow/games`);
runOnce(['run', 'build:games'], label.shared);

// Both servers listen on every interface, so the same app is reachable from a
// phone or another computer on the same network. Printing the addresses here
// saves guessing the machine's IP for a quick mobile check.
const lanAddresses = Object.values(os.networkInterfaces())
  .flat()
  .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
  .map((entry) => entry.address);

// `CAFEFLOW_DEV_HTTPS=1` serves the same app over TLS (self-signed), which a
// phone needs for secure-context APIs such as the iOS share sheet.
const scheme = process.env.CAFEFLOW_DEV_HTTPS === '1' ? 'https' : 'http';

console.log(`${label.api}  http://127.0.0.1:3000/api/v1`);
console.log(`${label.web}  ${scheme}://localhost:5173`);
for (const address of lanAddresses) {
  console.log(`${label.web}  ${scheme}://${address}:5173  ← از موبایل/شبکه محلی`);
}
console.log('');

start(label.api, ['run', 'dev:api']);
start(label.web, ['run', 'dev:web']);
