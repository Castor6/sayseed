import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { resetDatabaseForTests, sqlite } from './db';
import { getEffectivePrompt, getPromptHistory, getPromptSetting, listPromptSettings, previewPrompt, savePromptSetting } from './prompt-settings';
import { issueToken, resetSecretForTests } from './security';
import { GET as listRoute } from '../app/api/prompts/route';
import { GET as detailRoute, PATCH as saveRoute } from '../app/api/prompts/[kind]/route';
import { GET as historyRoute } from '../app/api/prompts/[kind]/history/route';
import { POST as previewRoute } from '../app/api/prompts/[kind]/preview/route';
import type { PromptSetting } from '@sayseed/shared';

const dir = mkdtempSync(join(tmpdir(), 'sayseed-prompts-'));
const versions = (setting: PromptSetting) => ({ revision: setting.revision, defaultVersion: setting.defaultVersion, protocolVersion: setting.protocolVersion });
before(() => {
  process.env.SAYSEED_DATA_DIR = dir;
  process.env.SAYSEED_PASSWORD = 'fixture-password';
  resetDatabaseForTests(); resetSecretForTests();
  const legacy = new Database(join(dir, 'sayseed.sqlite'));
  legacy.exec("CREATE TABLE connections (id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, base_url TEXT NOT NULL, encrypted_key TEXT NOT NULL); INSERT INTO connections VALUES ('legacy','旧供应商','openai','https://example.com','');");
  legacy.close();
});
after(() => { resetDatabaseForTests(); resetSecretForTests(); rmSync(dir, { recursive: true, force: true }); });

test('legacy databases retain data and default systems match pre-extraction hashes without writes', () => {
  const hashes = { translate: '8a79674e5b4c470ff97d4c273f671adfa5c797597cb3ef8757dffbe32e93d414', explain: '30acd83536dc1c8fb85bb5f9de79e7c00fd51d66fdc902b825a0c636b3186178' };
  for (const setting of listPromptSettings()) {
    assert.equal(createHash('sha256').update(setting.system).digest('hex'), hashes[setting.kind]);
    assert.equal(setting.revision, 0);
    assert.equal(getPromptHistory(setting.kind).items[0].body, setting.body);
    assert.equal(previewPrompt(setting.kind, { mode: 'default' }), setting.system);
    assert.ok(previewPrompt(setting.kind, { mode: 'custom', body: '草稿' }).includes('草稿'));
  }
  assert.equal((sqlite().prepare('SELECT COUNT(*) AS n FROM prompt_settings').get() as { n: number }).n, 0);
  assert.equal((sqlite().prepare('SELECT COUNT(*) AS n FROM prompt_revisions').get() as { n: number }).n, 0);
  assert.ok(sqlite().prepare("SELECT 1 FROM connections WHERE id='legacy'").get());
});

test('save is atomic, persists snapshots across reopen, restores defaults and supports history rollback', () => {
  const original = getPromptSetting('translate');
  const custom = savePromptSetting('translate', { mode: 'custom', body: '  自定义要求\n', ...versions(original) });
  assert.equal(custom.revision, 1);
  assert.equal(custom.body, '  自定义要求\n');
  assert.equal(getPromptHistory('translate').total, 2);
  assert.deepEqual(getPromptHistory('translate', { limit: 1, offset: 1 }).items[0], {
    kind: 'translate', mode: 'default', ...versions(original), body: original.body, updatedAt: null,
  });
  assert.throws(() => savePromptSetting('translate', { mode: 'custom', body: '旧页面', ...versions(original) }), { status: 409 });
  assert.equal(getPromptHistory('translate').total, 2);
  resetDatabaseForTests();
  assert.equal(getEffectivePrompt('translate').system, custom.system);
  // Simulate stored metadata from an earlier application release without changing its custom body.
  sqlite().prepare("UPDATE prompt_settings SET default_version='old', protocol_version='old' WHERE kind='translate'").run();
  assert.equal(getPromptSetting('translate').body, custom.body);
  assert.throws(() => savePromptSetting('translate', { mode: 'default', revision: 1, defaultVersion: 'old', protocolVersion: 'old' }), { status: 409 });
  const restored = savePromptSetting('translate', { mode: 'default', ...versions(custom) });
  assert.equal(restored.system, original.system);
  const rollback = savePromptSetting('translate', { mode: 'custom', body: getPromptHistory('translate').items[1].body, ...versions(restored) });
  assert.equal(rollback.body, custom.body);
  const count = getPromptHistory('translate').total;
  sqlite().exec("CREATE TRIGGER fail_prompt_history BEFORE INSERT ON prompt_revisions WHEN NEW.revision > 3 BEGIN SELECT RAISE(ABORT, 'fixture'); END;");
  assert.throws(() => savePromptSetting('translate', { mode: 'custom', body: '不能部分保存', ...versions(rollback) }));
  assert.equal(getPromptSetting('translate').revision, 3);
  assert.equal(getPromptHistory('translate').total, count);
  sqlite().exec('DROP TRIGGER fail_prompt_history');
});

function request(path: string, method = 'GET', body?: unknown, auth = true, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/prompts${path}`, { method,
    headers: { ...(auth ? { authorization: `Bearer ${issueToken()}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const params = (kind = 'explain') => ({ params: Promise.resolve({ kind }) });
test('routes enforce authentication, same origin, body limits, versions and bounded pagination', async () => {
  for (const route of [listRoute, detailRoute, historyRoute]) assert.equal((await route(request('', 'GET', undefined, false), params())).status, 401);
  for (const [route, method] of [[saveRoute, 'PATCH'], [previewRoute, 'POST']] as const) assert.equal((await route(request('/explain', method, {}, false), params())).status, 401);
  assert.equal((await listRoute(request(''))).status, 200);
  assert.equal((await detailRoute(request('/invalid'), params('invalid'))).status, 400);
  const setting = getPromptSetting('explain');
  for (const body of ['', ' \n ', 'a'.repeat(20001)]) {
    assert.equal((await saveRoute(request('/explain', 'PATCH', { mode: 'custom', body, ...versions(setting) }), params())).status, 400);
    assert.equal((await previewRoute(request('/explain/preview', 'POST', { mode: 'custom', body }), params())).status, 400);
  }
  const cookie = { cookie: `sayseed_session=${issueToken()}`, origin: 'https://other.example' };
  assert.equal((await saveRoute(request('/explain', 'PATCH', { mode: 'default', ...versions(setting) }, false, cookie), params())).status, 403);
  assert.equal((await historyRoute(request('/explain/history?limit=51'), params())).status, 400);
  assert.equal((await historyRoute(request('/explain/history?offset=-1'), params())).status, 400);
  assert.equal((await saveRoute(request('/explain', 'PATCH', { mode: 'default', ...versions(setting), protocolVersion: 'stale' }), params())).status, 409);
  const preview = await previewRoute(request('/explain/preview', 'POST', { mode: 'custom', body: '只解释语气。' }), params());
  assert.equal((await preview.json()).system, previewPrompt('explain', { mode: 'custom', body: '只解释语气。' }));
  assert.equal(getPromptSetting('explain').revision, 0);
  const result = await saveRoute(request('/explain', 'PATCH', { mode: 'custom', body: '只解释语气。', ...versions(setting) }), params());
  assert.equal(result.status, 200);
  assert.equal((await result.json()).prompt.revision, 1);
  const latest = getPromptSetting('explain');
  const competing = await Promise.all(['页面甲', '页面乙'].map(body =>
    saveRoute(request('/explain', 'PATCH', { mode: 'custom', body, ...versions(latest) }), params())));
  assert.deepEqual(competing.map(response => response.status).sort(), [200, 409]);
  assert.equal(getPromptSetting('explain').revision, 2);
  assert.equal(getPromptHistory('explain').total, 3);
});
