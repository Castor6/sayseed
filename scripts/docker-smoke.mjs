import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScope, fixtureEnv, freePort, runSmoke } from './ci-smoke.mjs';

const execute = promisify(execFile);
export function parseArgs(args) {
  const result = {};
  while (args.length) {
    const flag = args.shift();
    assert(['--image', '--previous-image'].includes(flag), `Unknown option: ${flag}`);
    assert(!result[flag], `Duplicate option: ${flag}`);
    const value = args.shift();
    assert(value && !value.startsWith('-') && !/\s/.test(value), `Invalid value for ${flag}`);
    result[flag] = value;
  }
  assert(result['--image'], 'Usage: node scripts/docker-smoke.mjs --image <tag> [--previous-image <digest>]');
  return { image: result['--image'], previousImage: result['--previous-image'] };
}

async function main() {
  const { image, previousImage } = parseArgs(process.argv.slice(2));
  assert.equal(process.platform, 'linux', 'Docker smoke requires Linux host networking');
  const scope = createScope(300_000);
  const id = `sayseed-smoke-${randomUUID()}`;
  const volume = `${id}-data`;
  const containers = [];
  let volumeCreated = false;
  const docker = async (args, cleanup = false) => {
    const result = await execute('docker', args, { timeout: cleanup ? 20_000 : 60_000, maxBuffer: 1024 * 1024, ...(cleanup ? {} : { signal: scope.signal }) });
    return result.stdout.trim();
  };
  try {
    const daemonPlatform = await docker(['info', '--format', '{{.OSType}}']);
    assert.equal(daemonPlatform, 'linux');
    const mockPort = await freePort();
    scope.start(process.execPath, ['scripts/mock-provider.mjs'], { persistent: true, env: fixtureEnv({ SAYSEED_MOCK_PORT: String(mockPort) }) });
    const mock = `http://127.0.0.1:${mockPort}`;
    await scope.ready(`${mock}/requests`);
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const password = `fixture-${randomUUID()}`;
    await docker(['volume', 'create', '--label', `sayseed.smoke=${id}`, volume]);
    volumeCreated = true;
    const launch = async (tag, name) => {
      containers.push(name);
      await docker(['run', '--detach', '--name', name, '--label', `sayseed.smoke=${id}`, '--network', 'host',
        '--mount', `type=volume,source=${volume},target=/app/data`,
        '--env', `PORT=${port}`, '--env', 'HOSTNAME=127.0.0.1', '--env', 'SAYSEED_DATA_DIR=/app/data',
        '--env', `SAYSEED_PASSWORD=${password}`, '--env', `SAYSEED_PUBLIC_URL=${url}`, tag]);
      await scope.ready(`${url}/api/health`);
      assert.equal(await docker(['inspect', '--format', '{{.State.Running}}', name]), 'true');
    };
    let token;
    const api = async (path, method = 'GET', body) => {
      const response = await fetch(`${url}/api${path}`, { method, signal: AbortSignal.any([scope.signal, AbortSignal.timeout(15_000)]),
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const result = await response.json();
      assert(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(result)}`);
      return result;
    };
    const initial = `${id}-initial`;
    await launch(previousImage || image, initial);
    token = (await api('/auth/login', 'POST', { password })).token;
    assert(token);
    const connection = (await api('/connections', 'POST', { name: 'Persistence fixture', provider: 'openai-compatible', baseUrl: `${mock}/v1`, apiKey: 'fixture-only-key' })).connection;
    const model = (await api('/models', 'POST', { connectionId: connection.id, name: 'Persistence fixture', modelId: 'fixture-translation' })).model;
    const note = (await api('/notes', 'POST', { expression: 'persist', sentence: 'This record should persist.', meaning: '保留', sentenceTranslation: '这条记录应该保留。', usage: 'Persistence fixture', sourceKind: 'webpage', sourceUrl: `https://example.com/${id}`, sourceTitle: 'Persistence fixture' })).note;
    const secretHash = name => docker(['exec', name, 'node', '-e', "const fs=require('node:fs');const crypto=require('node:crypto');process.stdout.write(crypto.createHash('sha256').update(fs.readFileSync('/app/data/.secret')).digest('hex'))"]);
    const secret = await secretHash(initial);
    const verify = async name => {
      assert.equal(await secretHash(name), secret, 'Persistent encryption key changed');
      const notes = await api('/notes');
      assert(notes.notes.some(value => value.id === note.id && value.expression === note.expression), 'SQLite note did not survive');
      assert((await api('/connections')).connections.some(value => value.id === connection.id));
      // The fixture rejects every key except the original plaintext key, proving decryption works.
      await api(`/models/${model.id}/test`, 'POST', {});
    };
    await verify(initial);
    await docker(['restart', '--time', '10', initial]);
    await scope.ready(`${url}/api/health`);
    await verify(initial);
    if (previousImage) {
      await docker(['stop', '--time', '10', initial]);
      const candidate = `${id}-candidate`;
      await launch(image, candidate);
      await verify(candidate);
      await docker(['restart', '--time', '10', candidate]);
      await scope.ready(`${url}/api/health`);
      await verify(candidate);
    }
    await runSmoke(scope, url, mock, password);
    console.log(`PASS: Docker fresh database, restart persistence, encryption key${previousImage ? ', same-volume upgrade' : ''}, and HTTP integration.`);
  } catch (error) {
    for (const name of containers) {
      try { const logs = await execute('docker', ['logs', '--tail', '80', name], { timeout: 10_000 }); console.error(logs.stdout, logs.stderr); } catch { /* The container may not have been created. */ }
    }
    throw error;
  } finally {
    const cleanupErrors = [];
    for (const name of containers.reverse()) {
      try { await docker(['rm', '--force', name], true); } catch (error) { cleanupErrors.push(error); }
    }
    if (volumeCreated) {
      try { await docker(['volume', 'rm', volume], true); } catch (error) { cleanupErrors.push(error); }
    }
    await scope.close();
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Docker cleanup failed');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
