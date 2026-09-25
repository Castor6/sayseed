import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { connectionPatchSchema, modelInputSchema, modelPatchSchema } from '@sayseed/shared';
import { resetDatabaseForTests, sqlite } from './db';
import { resetSecretForTests } from './security';
import { addConnection, addModel, editConnection, editModel, listModels } from './catalog';

const dataDir = mkdtempSync(join(tmpdir(), 'sayseed-capabilities-'));
before(() => {
  process.env.SAYSEED_DATA_DIR = dataDir;
  resetDatabaseForTests(); resetSecretForTests();
  const legacy = new Database(join(dataDir, 'sayseed.sqlite'));
  legacy.exec(`
    CREATE TABLE connections (id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, base_url TEXT NOT NULL, encrypted_key TEXT NOT NULL);
    CREATE TABLE models (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, name TEXT NOT NULL, model_id TEXT NOT NULL, supports_images INTEGER NOT NULL, is_default INTEGER NOT NULL);
    INSERT INTO connections VALUES ('legacy-connection', 'Legacy', 'openai-compatible', 'https://example.test/v1', '');
    INSERT INTO models VALUES ('legacy-model', 'legacy-connection', 'Legacy model', 'legacy', 1, 1);
  `);
  legacy.close();
});
after(() => { resetDatabaseForTests(); resetSecretForTests(); rmSync(dataDir, { recursive: true, force: true }); });

const capabilities = { supportsImages: true, contextWindow: 1048576, maxOutputTokens: 393216 };
function fixture() {
  const connection = addConnection({ name: 'Fixture', provider: 'openai-compatible', baseUrl: 'https://example.test/v1' });
  const model = addModel({ connectionId: connection.id, name: 'Fixture', modelId: 'fixture', capabilities });
  return { connection, model };
}

test('legacy database upgrades without losing existing image settings or fabricating capabilities', () => {
  const legacy = listModels().find(model => model.id === 'legacy-model');
  assert.equal(legacy?.supportsImages, true);
  assert.equal(legacy?.capabilities, undefined);
  resetDatabaseForTests();
  assert.equal(listModels().find(model => model.id === 'legacy-model')?.name, 'Legacy model');
});

test('declared image support applies by default, including false, while explicit manual settings take priority', () => {
  const { model, connection } = fixture();
  assert.equal(model.supportsImages, true);
  assert.deepEqual(listModels().find(saved => saved.id === model.id)?.capabilities, capabilities);
  const textOnly = editModel(model.id, { capabilities: { supportsImages: false, maxInputTokens: 200000 } });
  assert.equal(textOnly.supportsImages, false);
  assert.deepEqual(textOnly.capabilities, { supportsImages: false, maxInputTokens: 200000 });
  const manual = addModel({ connectionId: connection.id, name: 'Override', modelId: 'manual', capabilities, supportsImages: false });
  assert.equal(manual.supportsImages, false);
  assert.equal(manual.capabilities?.supportsImages, true);
});

test('partial edits preserve capabilities and an explicitly empty object clears them', () => {
  const { model } = fixture();
  const renamed = editModel(model.id, { name: 'Renamed' });
  assert.deepEqual(renamed.capabilities, capabilities);
  assert.equal(renamed.supportsImages, true);
  assert.equal(editModel(model.id, { capabilities: {} }).capabilities, undefined);
  assert.equal(listModels().find(saved => saved.id === model.id)?.supportsImages, false);
});

test('changing a model ID or connection does not carry capabilities to the new model', () => {
  const { model } = fixture();
  const changed = editModel(model.id, { modelId: 'another-model' });
  assert.equal(changed.capabilities, undefined);
  assert.equal(changed.supportsImages, false);
  editModel(model.id, { capabilities });
  const other = addConnection({ name: 'Other', provider: 'google' });
  const moved = editModel(model.id, { connectionId: other.id });
  assert.equal(moved.capabilities, undefined);
  assert.equal(moved.supportsImages, false);
});

test('connection endpoint, provider or key changes invalidate capabilities while a rename preserves them', () => {
  const { model, connection } = fixture();
  editConnection(connection.id, { name: 'Renamed connection' });
  assert.deepEqual(listModels().find(saved => saved.id === model.id)?.capabilities, capabilities);
  editConnection(connection.id, { baseUrl: 'https://other.example.test/v1' });
  assert.equal(listModels().find(saved => saved.id === model.id)?.capabilities, undefined);
  assert.equal(listModels().find(saved => saved.id === model.id)?.supportsImages, false);
  editModel(model.id, { capabilities });
  editConnection(connection.id, { provider: 'openai' });
  assert.equal(listModels().find(saved => saved.id === model.id)?.capabilities, undefined);
  editModel(model.id, { capabilities });
  editConnection(connection.id, { apiKey: 'fixture-only-new-key' });
  assert.equal(listModels().find(saved => saved.id === model.id)?.capabilities, undefined);
  assert.equal(listModels().find(saved => saved.id === model.id)?.supportsImages, false);
});

test('PATCH schemas preserve omitted endpoint and default-model fields instead of applying create defaults', () => {
  assert.deepEqual(connectionPatchSchema.parse({ name: 'Rename' }), { name: 'Rename' });
  assert.deepEqual(modelPatchSchema.parse({ capabilities }), { capabilities });
  const legacy = editModel('legacy-model', modelPatchSchema.parse({ capabilities }));
  assert.equal(legacy.isDefault, true);
});

test('invalid optional persisted metadata does not prevent listing models; invalid input limits are rejected', () => {
  const { model, connection } = fixture();
  sqlite().prepare('UPDATE models SET capabilities_json=? WHERE id=?').run('{invalid json', model.id);
  assert.equal(listModels().find(saved => saved.id === model.id)?.capabilities, undefined);
  for (const value of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '1000']) {
    assert.equal(modelInputSchema.safeParse({ connectionId: connection.id, name: 'Bad', modelId: 'bad', capabilities: { contextWindow: value } }).success, false);
  }
});
