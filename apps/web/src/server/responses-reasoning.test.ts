import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addConnection, addModel } from './catalog';
import { explain, testModel, translate } from './ai';
import { resetDatabaseForTests, sqlite } from './db';
import { createResponsesReasoningCollector } from './responses-reasoning';
import { resetSecretForTests } from './security';
import { usageDetail } from './usage';

test('raw Responses chunks replace duplicate done and final snapshots', () => {
  const collector = createResponsesReasoningCollector();
  collector.collectChunk({ type: 'response.reasoning_text.delta', item_id: 'rs-1', output_index: 0, content_index: 0, delta: 'First ' });
  collector.collectChunk({ type: 'response.reasoning_text.delta', item_id: 'rs-1', output_index: 0, content_index: 0, delta: 'thought.' });
  collector.collectChunk({ type: 'response.reasoning_text.done', item_id: 'rs-1', output_index: 0, content_index: 0, text: 'First thought.' });
  collector.collectChunk({ type: 'response.output_item.done', output_index: 0,
    item: { type: 'reasoning', id: 'rs-1', content: [{ type: 'reasoning_text', text: 'First thought.' }] } });
  collector.collectChunk({ type: 'response.completed', response: { output: [
    { type: 'reasoning', id: 'rs-1', content: [{ type: 'reasoning_text', text: 'First thought.' }] },
  ] } });
  assert.equal(collector.text(), 'First thought.');
  collector.collectChunk({ type: 'response.reasoning_summary_text.delta', delta: 'Summary only.' });
  assert.equal(collector.text(), 'First thought.');
  const failed = createResponsesReasoningCollector();
  failed.collectChunk({ type: 'response.failed', response: { output: [
    { type: 'reasoning', id: 'rs-2', content: [{ type: 'reasoning_text', text: 'Thought before failure.' }] },
  ] } });
  assert.equal(failed.text(), 'Thought before failure.');
});

const dir = mkdtempSync(join(tmpdir(), 'sayseed-responses-reasoning-'));
const requests: Array<Record<string, unknown>> = [];
const server = createServer(async (request, response) => {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw) as Record<string, unknown>;
  requests.push(body);
  const modelId = body.model as string;
  const answer = raw.includes('sentenceTranslation')
    ? JSON.stringify({ meaning: '接受', sentenceTranslation: '我接受。', usage: '自然表达。' })
    : 'Natural English.';
  const reasoningItem = { type: 'reasoning', id: 'rs_fixture',
    summary: modelId.includes('summary') ? [{ type: 'summary_text', text: 'Summary only.' }] : [],
    ...(!modelId.includes('summary') ? { content: [{ type: 'reasoning_text', text: modelId.includes('slow') ? 'Partial thought.' : 'First thought. Second thought.' }] } : {}) };
  const messageItem = { type: 'message', id: 'msg_fixture', role: 'assistant',
    content: [{ type: 'output_text', text: answer, annotations: [] }] };
  const final = { id: 'resp_fixture', created_at: 1, model: modelId, output: [reasoningItem, messageItem],
    usage: { input_tokens: 12, output_tokens: 15, output_tokens_details: { reasoning_tokens: 7 } } };
  if (!body.stream) {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(final));
    return;
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const event = (value: Record<string, unknown>) => response.write(`data: ${JSON.stringify(value)}\n\n`);
  event({ type: 'response.created', response: { id: 'resp_fixture', created_at: 1, model: modelId } });
  event({ type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'rs_fixture' } });
  event({ type: 'response.reasoning_text.delta', item_id: 'rs_fixture', output_index: 0, content_index: 0,
    delta: modelId.includes('slow') ? 'Partial thought.' : 'First thought. ' });
  if (!modelId.includes('slow')) {
    event({ type: 'response.reasoning_text.delta', item_id: 'rs_fixture', output_index: 0, content_index: 0, delta: 'Second thought.' });
    event({ type: 'response.reasoning_text.done', item_id: 'rs_fixture', output_index: 0, content_index: 0, text: 'First thought. Second thought.' });
    event({ type: 'response.output_item.done', output_index: 0, item: reasoningItem });
  }
  event({ type: 'response.output_item.added', output_index: 1, item: { type: 'message', id: 'msg_fixture' } });
  event({ type: 'response.output_text.delta', item_id: 'msg_fixture', output_index: 1,
    delta: modelId.includes('slow') ? 'First ' : answer });
  if (modelId.includes('slow')) {
    await new Promise(resolve => setTimeout(resolve, 250));
    if (response.destroyed) return;
  }
  event({ type: 'response.completed', response: final });
  response.end('data: [DONE]\n\n');
});
let baseUrl = '';
before(async () => {
  process.env.SAYSEED_DATA_DIR = dir;
  process.env.SAYSEED_PASSWORD = 'fixture-password';
  resetDatabaseForTests(); resetSecretForTests();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  resetDatabaseForTests(); resetSecretForTests(); rmSync(dir, { recursive: true, force: true });
});

function model(id: string) {
  const connection = addConnection({ name: `Fixture ${id}`, provider: 'openai', baseUrl, apiKey: 'fixture-only-key' });
  return addModel({ connectionId: connection.id, name: id, modelId: id });
}
function latest(id: string) {
  const row = sqlite().prepare('SELECT id, status FROM usage_logs WHERE model_id=? ORDER BY rowid DESC LIMIT 1').get(id) as { id: string; status: string };
  return { ...row, detail: usageDetail(row.id) };
}

test('installed Responses SDK preserves raw DeepSeek reasoning in translation and cancellation logs', async () => {
  const complete = model('fixture-deepseek-complete');
  const stream = await translate({ modelId: complete.id, draft: '你好', context: { mode: 'post', ancestors: [], supplement: '', incompleteReasons: [] } });
  assert.match(await new Response(stream).text(), /Natural English/);
  const logged = latest(complete.modelId);
  assert.equal(logged.status, 'success');
  assert.equal(logged.detail.context?.output?.reasoning, 'First thought. Second thought.');
  assert.equal(logged.detail.record.reasoningTokens, 7);
  assert.equal(requests.at(-1)?.stream, true);
  assert(!JSON.stringify(logged.detail).includes('fixture-only-key'));

  const slow = model('fixture-deepseek-slow');
  const cancelled = await translate({ modelId: slow.id, draft: '你好', context: { mode: 'post', ancestors: [], supplement: '', incompleteReasons: [] } });
  const reader = cancelled.getReader();
  await reader.read();
  await reader.cancel();
  const partial = latest(slow.modelId);
  assert.equal(partial.status, 'cancelled');
  assert.equal(partial.detail.context?.output?.reasoning, 'Partial thought.');
  assert.equal(partial.detail.context?.output?.text, 'First ');
  assert.equal((sqlite().prepare('SELECT count(*) AS n FROM usage_logs WHERE model_id=?').get(slow.modelId) as { n: number }).n, 1);

});

test('installed Responses SDK preserves raw reasoning in non-streaming explanation and model test', async () => {
  const entry = model('fixture-deepseek-nonstream');
  assert.equal((await explain({ selection: 'buy', sentence: 'I buy that.', modelId: entry.id })).meaning, '接受');
  assert.equal(latest(entry.modelId).detail.context?.output?.reasoning, 'First thought. Second thought.');
  assert.equal((await testModel(entry.id)).ok, true);
  assert.equal(latest(entry.modelId).detail.context?.output?.reasoning, 'First thought. Second thought.');
  assert.equal(requests.at(-1)?.stream, undefined);

  const standard = model('fixture-openai-summary');
  assert.equal((await testModel(standard.id)).ok, true);
  assert.equal(latest(standard.modelId).detail.context?.output?.reasoning, 'Summary only.');
});
