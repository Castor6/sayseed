import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { sanitizeStandalone } from './sanitize-standalone.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'sanitize-standalone-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, 'standalone');
  mkdirSync(output);
  const write = (relative) => {
    const path = join(output, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'fictional-private-canary');
  };
  return { directory, output, write };
}

test('removes private files and app data while preserving runtime dependency assets', t => {
  const { output, write } = fixture(t);
  const privateFiles = ['apps/web/.env.production', '.env', 'apps/web/.env.local',
    'apps/web/data/custom-name', 'data/custom-name', 'backup/example.sqlite',
    'backup/example.sqlite-wal', 'backup/example.sqlite-shm', 'backup/example.db',
    'backup/example.db-journal', 'backup/example.sqlite3', 'backup/.secret'];
  const runtimeFiles = ['apps/web/server.js', 'node_modules/example/data/runtime.json'];
  for (const path of [...privateFiles, ...runtimeFiles]) write(path);
  sanitizeStandalone(output);
  for (const path of privateFiles) assert.equal(existsSync(join(output, path)), false, path);
  for (const path of runtimeFiles) assert.equal(existsSync(join(output, path)), true, path);
  assert.equal(sanitizeStandalone(output), 0);
});

test('never follows directory or private-file symlinks outside the output', t => {
  const { directory, output } = fixture(t);
  const external = join(directory, 'external');
  mkdirSync(external);
  writeFileSync(join(external, '.secret'), 'external-canary');
  symlinkSync(external, join(output, 'linked-directory'));
  symlinkSync(external, join(output, 'data'));
  symlinkSync(join(external, '.secret'), join(output, '.env'));
  sanitizeStandalone(output);
  assert.equal(readFileSync(join(external, '.secret'), 'utf8'), 'external-canary');
  assert.equal(existsSync(join(output, 'linked-directory')), true);
  assert.equal(existsSync(join(output, 'data')), false);
  assert.equal(existsSync(join(output, '.env')), false);
});

test('rejects a symlink used as the output root', t => {
  const { directory, output } = fixture(t);
  const link = join(directory, 'output-link');
  symlinkSync(output, link);
  assert.throws(() => sanitizeStandalone(link), /real directory/);
});
