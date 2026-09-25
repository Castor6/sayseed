import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { addConnection, addModel } from './catalog';
import { explain, testModel, translate } from './ai';
import { resetDatabaseForTests, sqlite } from './db';
import { resetSecretForTests, issueToken } from './security';
import { listUsage, startModelUsage, usageDetail } from './usage';
import { GET as usageRoute } from '../app/api/usage/route';
import { GET as usageDetailRoute } from '../app/api/usage/[id]/route';
import type { Model } from '@sayseed/shared';
import { TRANSLATE_SYSTEM, buildTranslationPrompt } from './prompts';

const dir = mkdtempSync(join(tmpdir(), 'sayseed-usage-'));
const observedRequests: Array<Record<string, any>> = [];
const server = createServer(async (request, response) => {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw) as { model: string; stream?: boolean };
  observedRequests.push(body);
  if (body.model.includes('failure')) {
    response.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Fixture failed', type: 'api_error' } }));
    return;
  }
  const output = body.model.includes('invalid') ? 'not json' : raw.includes('sentenceTranslation')
    ? JSON.stringify({ meaning: '接受', sentenceTranslation: '我不太接受。', usage: '口语表达。' })
    : 'Natural English.';
  if (!body.stream) {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      id: 'chatcmpl_usage', object: 'chat.completion', created: 1, model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: output,
        ...(body.model.includes('reasoning') ? { reasoning_content: 'Provider reasoning.' } : {}) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20, prompt_tokens_details: { cached_tokens: 4 }, completion_tokens_details: { reasoning_tokens: 3 } },
    }));
    return;
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const chunk = (text: string, finishReason: string | null, withUsage = false) => response.write(`data: ${JSON.stringify({
    id: 'chatcmpl_usage', object: 'chat.completion.chunk', created: 1, model: body.model,
    choices: [{ index: 0, delta: { content: text,
      ...(body.model.includes('reasoning') && finishReason === null ? { reasoning_content: 'Stream reasoning.' } : {}) }, finish_reason: finishReason }],
    ...(withUsage ? { usage: { prompt_tokens: 14, completion_tokens: 7, total_tokens: 21 } } : {}),
  })}\n\n`);
  chunk(body.model.includes('slow') ? 'First ' : output, null);
  if (body.model.includes('slow')) await new Promise(resolve => setTimeout(resolve, 200));
  if (!response.destroyed) { chunk('', body.model.includes('truncated') ? 'length' : 'stop', true); response.end('data: [DONE]\n\n'); }
});
let baseUrl = '';
before(async () => {
  process.env.SAYSEED_DATA_DIR = dir;
  process.env.SAYSEED_PASSWORD = 'fixture-password';
  resetDatabaseForTests(); resetSecretForTests();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  resetDatabaseForTests(); resetSecretForTests(); rmSync(dir, { recursive: true, force: true });
});

function model(id: string, supportsImages = false) {
  const connection = addConnection({ name: `Connection ${id}`, provider: 'openai-compatible', baseUrl, apiKey: 'fixture-only-key' });
  return addModel({ connectionId: connection.id, name: `Model ${id}`, modelId: id, supportsImages });
}
function rows() { return sqlite().prepare('SELECT * FROM usage_logs ORDER BY rowid').all() as Array<Record<string, any>>; }

test('usage snapshots, unknown tokens, filtered summary, pagination and authorization', async () => {
  const entry: Model = model('fixture-manual');
  const recorder = startModelUsage(entry, 'openai-compatible', 'test');
  recorder.finish('success', {
    inputTokens: 0, outputTokens: 8, totalTokens: 8,
    inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: 0, cacheWriteTokens: undefined },
    outputTokenDetails: { textTokens: undefined, reasoningTokens: 3 },
    raw: { prompt_tokens: 0, completion_tokens: 8, total_tokens: 8, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 3 } },
  });
  recorder.finish('error', null, 'provider_error');
  const item = rows().at(-1)!;
  assert.equal(item.model_name, entry.name);
  assert.equal(item.connection_name, 'Connection fixture-manual');
  assert.equal(item.input_tokens, 0);
  assert.equal(item.cache_write_tokens, null);
  const unauthorized = await usageRoute(new Request('http://localhost/api/usage'));
  assert.equal(unauthorized.status, 401);
  const request = new Request('http://localhost/api/usage?limit=1&offset=0&purpose=test', { headers: { Authorization: `Bearer ${issueToken()}` } });
  const authorized = await usageRoute(request);
  assert.equal(authorized.status, 200);
  const result = await authorized.json();
  assert.equal(result.total, 1);
  assert.equal(result.items.length, 1);
  assert.equal('context' in result.items[0], false);
  assert.equal('context_json' in result.items[0], false);
  assert.deepEqual(result.summary.inputTokens, { knownSum: 0, unknownCount: 0 });
  assert.deepEqual(result.summary.cacheWriteTokens, { knownSum: 0, unknownCount: 1 });
  const detailRequest = new Request(`http://localhost/api/usage/${item.id}`, { headers: { Authorization: `Bearer ${issueToken()}` } });
  const detail = await usageDetailRoute(detailRequest, { params: Promise.resolve({ id: item.id }) });
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).context, null);
  assert.equal((await usageDetailRoute(new Request(`http://localhost/api/usage/${item.id}`), { params: Promise.resolve({ id: item.id }) })).status, 401);
  assert.equal((await usageDetailRoute(detailRequest, { params: Promise.resolve({ id: 'missing' }) })).status, 404);
  const second = model('fixture-manual-second');
  startModelUsage(second, 'openai-compatible', 'explain').finish('error', null, 'provider_error');
  const filtered = listUsage(new URLSearchParams({ purpose: 'explain', status: 'error', modelId: second.id }));
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0].modelRecordId, second.id);
  assert.deepEqual(filtered.summary.totalTokens, { knownSum: 0, unknownCount: 1 });
  const paged = listUsage(new URLSearchParams({ limit: '1', offset: '1' }));
  assert.equal(paged.total, 2);
  assert.equal(paged.items.length, 1);
  assert.equal((await usageRoute(new Request('http://localhost/api/usage?limit=999', { headers: { Authorization: `Bearer ${issueToken()}` } }))).status, 400);
  assert.equal((await usageRoute(new Request('http://localhost/api/usage?status=invalid', { headers: { Authorization: `Bearer ${issueToken()}` } }))).status, 400);
  sqlite().prepare('DELETE FROM models WHERE id=?').run(entry.id);
  assert(listUsage(new URLSearchParams()).models.some(value => value.id === entry.id));
});

test('a derived total stays unknown when only one side of usage is reported', () => {
  const entry = model('fixture-partial-usage');
  const partial = {
    inputTokens: 12, outputTokens: undefined, totalTokens: 12,
    inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    raw: { prompt_tokens: 12 },
  };
  startModelUsage(entry, 'openai-compatible', 'test').finish('success', partial);
  assert.equal(rows().at(-1)!.total_tokens, null);
  startModelUsage(entry, 'openai-compatible', 'test').finish('success', { ...partial, raw: { prompt_tokens: 12, total_tokens: 12 } });
  assert.equal(rows().at(-1)!.total_tokens, 12);
});

test('model test and explanation log success, provider failure and unusable output', async () => {
  const good = model('fixture-good');
  const failed = model('fixture-failure');
  const invalid = model('fixture-invalid');
  assert.equal((await testModel(good.id)).ok, true);
  assert.equal((await explain({ selection: 'buy', sentence: 'I do not buy that.', modelId: good.id })).meaning, '接受');
  await assert.rejects(testModel(failed.id));
  await assert.rejects(explain({ selection: 'buy', sentence: 'I do not buy that.', modelId: invalid.id }));
  const recent = rows().slice(-4);
  assert.deepEqual(recent.map(row => [row.purpose, row.status]), [['test', 'success'], ['explain', 'success'], ['test', 'error'], ['explain', 'error']]);
  assert.equal(recent[0].input_tokens, 12);
  assert.equal(recent[0].output_tokens, 8);
  assert.equal(recent[0].total_tokens, 20);
  assert.equal(recent[0].reasoning_tokens, 3);
  assert.equal(recent[0].cache_read_tokens, 4);
  assert.equal(recent[2].input_tokens, null);
  assert.equal(recent[3].error_code, 'invalid_output');
  assert(!JSON.stringify(recent).includes('Fixture failed'));
});

test('streaming translation logs success, cancellation, provider error and truncated output with usage', async () => {
  const good = model('fixture-stream-good');
  const slow = model('fixture-slow');
  const failed = model('fixture-stream-failure');
  const truncated = model('fixture-truncated');
  const input = { draft: '你好', context: { mode: 'post' as const, ancestors: [], supplement: '', incompleteReasons: [] } };
  const completed = await translate({ ...input, modelId: good.id });
  assert.match(await new Response(completed).text(), /Natural English/);
  const cancelled = await translate({ ...input, modelId: slow.id });
  const reader = cancelled.getReader();
  await reader.read();
  await reader.cancel();
  const errored = await translate({ ...input, modelId: failed.id });
  assert.match(await new Response(errored).text(), /"type":"error"/);
  const cut = await translate({ ...input, modelId: truncated.id });
  assert.match(await new Response(cut).text(), /"type":"error"/);
  const recent = rows().slice(-4);
  assert.deepEqual(recent.map(row => row.status).sort(), ['cancelled', 'error', 'error', 'success']);
  assert.equal(recent.filter(row => row.model_id === slow.modelId).length, 1);
  assert.equal(usageDetail(recent.find(row => row.model_id === slow.modelId)!.id).context?.output?.text, 'First ');
  const success = recent.find(row => row.model_id === good.modelId)!;
  assert.equal(success.input_tokens, 14);
  assert.equal(success.output_tokens, 7);
  assert.equal(success.total_tokens, 21);
  assert.equal(success.reasoning_tokens, null);
  const incomplete = recent.find(row => row.model_id === truncated.modelId)!;
  assert.equal(incomplete.error_code, 'incomplete');
  assert.equal(incomplete.input_tokens, 14);
  assert.equal(incomplete.total_tokens, 21);
});

test('text-only translation ignores legacy images and records only the actual prompt and output', async t => {
  const entry = model('fixture-context-reasoning');
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=';
  const imageUrl = 'https://pbs.twimg.com/media/sayseed-fixture-do-not-fetch.jpg';
  const originalFetch = globalThis.fetch;
  let imageFetches = 0;
  t.mock.method(globalThis, 'fetch', (target: string | URL | Request, init?: RequestInit) => {
    const url = target instanceof Request ? target.url : String(target);
    if (url.startsWith('https://pbs.twimg.com/')) { imageFetches++; throw new Error('Image fetch is forbidden in this test'); }
    return originalFetch(target, init);
  });
  const input = { draft: '这个我没想到。', modelId: entry.id, context: {
    mode: 'reply' as const, target: { text: 'Interesting angle.', images: [image, imageUrl] },
    ancestors: [], supplement: '这里是认真请教。', incompleteReasons: [],
  } };
  const response = await translate(input);
  assert.match(await new Response(response).text(), /Natural English/);
  const row = rows().at(-1)!;
  const detail = usageDetail(row.id);
  assert.equal(detail.context?.system, TRANSLATE_SYSTEM);
  assert.equal(detail.context?.messages[0].content[0].type, 'text');
  assert.equal((detail.context?.messages[0].content[0] as { text: string }).text, buildTranslationPrompt(input));
  assert.equal(detail.context?.messages[0].content.length, 1);
  assert.equal(imageFetches, 0);
  assert.equal(detail.context?.output?.text, 'Natural English.');
  assert.match(detail.context?.output?.reasoning ?? '', /Stream reasoning/);
  assert.equal(detail.context?.options.timeoutMs, 45000);
  assert(JSON.stringify(observedRequests.at(-1)).includes('Interesting angle.'));
  assert(!JSON.stringify(observedRequests.at(-1)).includes(image.slice(22)));
  assert(!JSON.stringify(observedRequests.at(-1)).includes(imageUrl));
  assert(!JSON.stringify(detail).includes(image.slice(22)));
  assert(!JSON.stringify(detail).includes(imageUrl));
  assert(!JSON.stringify(detail).includes('fixture-only-key'));
  assert(!JSON.stringify(listUsage(new URLSearchParams())).includes('这个我没想到'));

  const explanation = await explain({ selection: 'buy', sentence: 'I do not buy that.', modelId: entry.id });
  const explained = usageDetail(rows().at(-1)!.id);
  assert.equal(explained.context?.system?.includes('英语语境解释助手'), true);
  assert.equal(explained.context?.output?.text, JSON.stringify(explanation));
  assert.equal(explained.context?.output?.reasoning, 'Provider reasoning.');
  await testModel(entry.id);
  const tested = usageDetail(rows().at(-1)!.id);
  assert.equal(tested.context?.system, null);
  assert.equal(tested.context?.messages[0].content[0].type, 'text');
  assert.equal(tested.context?.output?.reasoning, 'Provider reasoning.');
  assert.equal(tested.context?.options.maxOutputTokens, 128);
});

test('a usage insert failure does not break a completed model request', async () => {
  const good = model('fixture-log-unwritable');
  sqlite().exec(`CREATE TRIGGER reject_usage_log BEFORE INSERT ON usage_logs BEGIN SELECT RAISE(ABORT, 'fixture rejection'); END`);
  try { assert.equal((await testModel(good.id)).ok, true); }
  finally { sqlite().exec('DROP TRIGGER reject_usage_log'); }
  assert.equal(rows().filter(row => row.model_id === good.modelId).length, 0);
});

test('an existing usage table gains nullable context without losing old records', () => {
  const legacyDir = mkdtempSync(join(tmpdir(), 'sayseed-legacy-usage-'));
  const oldDir = process.env.SAYSEED_DATA_DIR;
  resetDatabaseForTests();
  try {
    const legacy = new Database(join(legacyDir, 'sayseed.sqlite'));
    legacy.exec(`CREATE TABLE usage_logs (
      id TEXT PRIMARY KEY, started_at TEXT NOT NULL, duration_ms INTEGER NOT NULL,
      model_record_id TEXT NOT NULL, model_name TEXT NOT NULL, connection_name TEXT NOT NULL,
      provider TEXT NOT NULL, model_id TEXT NOT NULL, purpose TEXT NOT NULL, status TEXT NOT NULL,
      reasoning_effort TEXT, error_code TEXT, input_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER,
      reasoning_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER
    );
    INSERT INTO usage_logs (id,started_at,duration_ms,model_record_id,model_name,connection_name,provider,model_id,purpose,status)
      VALUES ('legacy-record','2026-01-01T00:00:00.000Z',10,'old-model','Old','Old supplier','openai','old-model','test','success');`);
    legacy.close();
    process.env.SAYSEED_DATA_DIR = legacyDir;
    const columns = sqlite().pragma('table_info(usage_logs)') as { name: string }[];
    assert(columns.some(column => column.name === 'context_json'));
    assert.equal(usageDetail('legacy-record').context, null);
    assert.equal(listUsage(new URLSearchParams()).total, 1);
  } finally {
    resetDatabaseForTests();
    process.env.SAYSEED_DATA_DIR = oldDir;
    rmSync(legacyDir, { recursive: true, force: true });
  }
});
