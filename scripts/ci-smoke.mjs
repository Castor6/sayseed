import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

// Do not inherit production configuration or Node preload hooks into test servers.
export function fixtureEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('SAYSEED_') && !['NODE_OPTIONS', 'NODE_ENV', 'PORT', 'HOSTNAME'].includes(key)));
  return { ...env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', ...extra };
}

export function createScope(timeoutMs = 180_000) {
  const controller = new AbortController();
  const children = new Set();
  let closing = false;
  const abort = reason => controller.abort(reason);
  const signals = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => abort(new Error(`Received ${signal}`))]));
  for (const [signal, listener] of signals) process.on(signal, listener);
  const timer = setTimeout(() => abort(new Error('Smoke test timed out')), timeoutMs);
  function start(command, args, { persistent = false, ...options } = {}) {
    controller.signal.throwIfAborted();
    const child = spawn(command, args, { cwd: root, env: fixtureEnv(), stdio: 'inherit', ...options });
    children.add(child);
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? signal}`)));
    });
    done.then(() => {
      children.delete(child);
      if (persistent && !closing) abort(new Error(`${command} stopped unexpectedly`));
    }, error => { children.delete(child); if (!closing) abort(error); });
    return { child, done };
  }
  async function wait(promise) {
    controller.signal.throwIfAborted();
    let listener;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        listener = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', listener, { once: true });
      })]);
    } finally { controller.signal.removeEventListener('abort', listener); }
  }
  async function ready(url, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      controller.signal.throwIfAborted();
      try {
        const response = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1000)]) });
        await response.arrayBuffer();
        if (response.ok) return;
      } catch { controller.signal.throwIfAborted(); }
      await delay(100, undefined, { signal: controller.signal });
    }
    throw new Error(`Timed out waiting for ${url}`);
  }
  async function close() {
    closing = true;
    clearTimeout(timer);
    const running = [...children];
    await Promise.all(running.map(child => new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.once('close', () => { clearTimeout(kill); resolve(); });
      child.kill('SIGTERM');
    })));
    for (const [signal, listener] of signals) process.off(signal, listener);
  }
  return { start, wait, ready, close, signal: controller.signal };
}

export async function runSmoke(scope, url, mock, password) {
  await scope.wait(scope.start(process.execPath, [join(root, 'scripts/smoke.mjs')], {
    env: fixtureEnv({ SAYSEED_SMOKE_URL: url, SAYSEED_MOCK_URL: mock, SAYSEED_SMOKE_PASSWORD: password }),
  }).done);
}

async function main() {
  const scope = createScope();
  let temporary;
  try {
    temporary = await mkdtemp(join(tmpdir(), 'sayseed-ci-'));
    const standalone = join(root, 'apps/web/.next/standalone');
    const destination = join(temporary, 'app');
    await cp(standalone, destination, { recursive: true, filter: source => { const name = source.slice(source.lastIndexOf('/') + 1); return ![join(standalone, 'data'), join(standalone, 'apps/web/data')].includes(source) && name !== '.env' && !name.startsWith('.env.'); } });
    await cp(join(root, 'apps/web/.next/static'), join(destination, 'apps/web/.next/static'), { recursive: true });
    await cp(join(root, 'apps/web/public'), join(destination, 'apps/web/public'), { recursive: true });
    const mockPort = await freePort();
    scope.start(process.execPath, ['scripts/mock-provider.mjs'], { persistent: true, env: fixtureEnv({ SAYSEED_MOCK_PORT: String(mockPort) }) });
    const mock = `http://127.0.0.1:${mockPort}`;
    await scope.ready(`${mock}/requests`);
    const port = await freePort();
    assert.notEqual(port, mockPort);
    const url = `http://127.0.0.1:${port}`;
    const password = `fixture-${randomUUID()}`;
    scope.start(process.execPath, [join(destination, 'apps/web/server.js')], { persistent: true, cwd: destination,
      env: fixtureEnv({ HOSTNAME: '127.0.0.1', PORT: String(port), SAYSEED_PASSWORD: password, SAYSEED_DATA_DIR: join(temporary, 'data'), SAYSEED_PUBLIC_URL: url }),
    });
    await scope.ready(`${url}/api/health`);
    await runSmoke(scope, url, mock, password);
  } finally {
    await scope.close();
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
