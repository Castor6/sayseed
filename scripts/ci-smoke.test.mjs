import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createScope, fixtureEnv, freePort } from './ci-smoke.mjs';
import { parseArgs } from './docker-smoke.mjs';

test('fixture environment cannot inherit production configuration', () => {
  const previous = process.env.SAYSEED_SECRET;
  process.env.SAYSEED_SECRET = 'not-a-fixture';
  try {
    const env = fixtureEnv({ SAYSEED_PASSWORD: 'fixture' });
    assert.equal(env.SAYSEED_SECRET, undefined);
    assert.equal(env.SAYSEED_PASSWORD, 'fixture');
  } finally {
    if (previous === undefined) delete process.env.SAYSEED_SECRET; else process.env.SAYSEED_SECRET = previous;
  }
});

test('readiness has a bounded timeout', async () => {
  const scope = createScope();
  const server = createServer((_request, response) => response.writeHead(503).end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await assert.rejects(scope.ready(`http://127.0.0.1:${server.address().port}`, 100), /Timed out/); }
  finally { await scope.close(); await new Promise(resolve => server.close(resolve)); }
});

test('unexpected service exit interrupts readiness', async () => {
  const scope = createScope();
  try {
    const port = await freePort();
    scope.start(process.execPath, ['-e', 'process.exit(7)'], { persistent: true, stdio: 'ignore' });
    await assert.rejects(scope.ready(`http://127.0.0.1:${port}`));
    assert.equal(scope.signal.aborted, true);
  } finally { await scope.close(); }
});

test('scope deadline terminates child processes during cleanup', async () => {
  const scope = createScope(100);
  const { child, done } = scope.start(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], { stdio: 'ignore' });
  await assert.rejects(scope.wait(done), /timed out/);
  await scope.close();
  assert(child.exitCode !== null || child.signalCode !== null);
});

test('Docker CLI requires an explicit candidate and rejects unknown input', () => {
  assert.deepEqual(parseArgs(['--image', 'sayseed:test']), { image: 'sayseed:test', previousImage: undefined });
  assert.deepEqual(parseArgs(['--previous-image', 'sayseed@sha256:abc', '--image', 'sayseed:test']), { image: 'sayseed:test', previousImage: 'sayseed@sha256:abc' });
  for (const args of [[], ['--image'], ['--image', '--privileged'], ['--volume', 'real-data'], ['--image', 'a', '--image', 'b']]) assert.throws(() => parseArgs(args));
});


test('termination signals interrupt work and listeners are removed after cleanup', async () => {
  const before = process.listenerCount('SIGTERM');
  const scope = createScope();
  const { done } = scope.start(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], { stdio: 'ignore' });
  const waiting = scope.wait(done);
  process.emit('SIGTERM');
  await assert.rejects(waiting, /Received SIGTERM/);
  await scope.close();
  assert.equal(process.listenerCount('SIGTERM'), before);
});
