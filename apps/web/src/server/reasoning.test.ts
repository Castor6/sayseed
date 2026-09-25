import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { addConnection, addModel, editConnection, editModel, listModels, recordDiscoveredEffort } from './catalog';
import { resetDatabaseForTests, sqlite } from './db';
import { reasoningProviderOptions, testModel } from './ai';
import { resetSecretForTests } from './security';
import { issueToken } from './security';
import { GET as availableModels } from '../app/api/connections/[id]/available-models/route';
import { reasoningEffortLabel } from '../components/reasoning-label';

const dir = mkdtempSync(join(tmpdir(), 'sayseed-reasoning-'));
before(() => { process.env.SAYSEED_DATA_DIR = dir; process.env.SAYSEED_PASSWORD = 'fixture-password'; resetDatabaseForTests(); resetSecretForTests(); });
after(() => { resetDatabaseForTests(); resetSecretForTests(); rmSync(dir, { recursive: true, force: true }); });

test('provider options use SDK keys and omit settings when following the provider', () => {
  assert.equal(reasoningProviderOptions('openai', null), undefined);
  assert.equal(reasoningProviderOptions('google', null), undefined);
  assert.deepEqual(reasoningProviderOptions('openai', 'high'), { openai: { reasoningEffort: 'high', forceReasoning: true, reasoningSummary: null } });
  assert.deepEqual(reasoningProviderOptions('openai-compatible', 'low'), { openaiCompatible: { reasoningEffort: 'low' } });
  assert.deepEqual(reasoningProviderOptions('anthropic', 'xhigh'), { anthropic: { effort: 'xhigh' } });
  assert.equal(reasoningEffortLabel('none'), '关闭');
});

test('the installed SDK sends saved effort to local OpenAI Responses, compatible chat, and Anthropic endpoints', async () => {
  const requests: Array<{ path: string; body: Record<string, any> }> = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw) as Record<string, any>;
    requests.push({ path: request.url || '', body });
    const payload = request.url?.endsWith('/responses')
      ? { id: 'resp_fixture', created_at: 1, model: body.model, output: [{ type: 'message', id: 'msg_fixture', role: 'assistant', content: [{ type: 'output_text', text: 'OK', annotations: [] }] }] }
      : request.url?.endsWith('/messages')
        ? { id: 'msg_fixture', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }
        : { id: 'chatcmpl_fixture', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    for (const [provider, effort, path] of [
      ['openai', 'high', '/openai/responses'],
      ['openai-compatible', 'low', '/compatible/chat/completions'],
      ['anthropic', 'xhigh', '/anthropic/messages'],
      ['openai', 'none', '/openai/responses'],
      ['openai-compatible', 'none', '/compatible/chat/completions'],
    ] as const) {
      const connection = addConnection({ name: `Local ${provider}`, provider, baseUrl: `${base}/${provider === 'openai-compatible' ? 'compatible' : provider}`, apiKey: 'fixture-only-key' });
      const modelId = `fixture-${provider}`;
      recordDiscoveredEffort(connection.id, { truncated: false, models: [{ id: modelId, name: modelId, capabilities: { reasoningEffortLevels: [effort] } }] });
      const model = addModel({ connectionId: connection.id, name: modelId, modelId, reasoningEffort: effort });
      assert.deepEqual(await testModel(model.id), { ok: true, message: '连接成功' });
      assert.equal(requests.at(-1)?.path, path);
      const body = requests.at(-1)?.body;
      assert.equal(provider === 'anthropic' ? body?.output_config?.effort : provider === 'openai' ? body?.reasoning?.effort : body?.reasoning_effort, effort);
      if (provider === 'openai') assert.equal('summary' in body!.reasoning, false);
      if (provider === 'anthropic') assert.equal('thinking' in body!, false);
      if (provider === 'openai-compatible') {
        editModel(model.id, { reasoningEffort: null });
        assert.deepEqual(await testModel(model.id), { ok: true, message: '连接成功' });
        assert.equal('reasoning_effort' in requests.at(-1)!.body, false);
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('trusted discovery is required for explicit effort and forged client capability is discarded', () => {
  const connection = addConnection({ name: 'Local fixture', provider: 'openai-compatible', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture-key' });
  const body = { connectionId: connection.id, name: 'Example', modelId: 'deepseek-fixture', capabilities: { reasoningEffortLevels: ['max'], defaultReasoningEffort: 'max' } };
  assert.throws(() => addModel({ ...body, reasoningEffort: 'max' }), /模型列表未确认/);
  const unknown = addModel(body);
  assert.equal(unknown.reasoningEffort, null);
  assert.equal(unknown.capabilities, undefined);
  recordDiscoveredEffort(connection.id, { truncated: false, models: [{ id: 'deepseek-fixture', name: 'DeepSeek', capabilities: { reasoningEffortLevels: ['low', 'high'], defaultReasoningEffort: 'high' } }] });
  assert.deepEqual(listModels().find(model => model.id === unknown.id)?.capabilities, { reasoningEffortLevels: ['low', 'high'], defaultReasoningEffort: 'high' });
  assert.throws(() => editModel(unknown.id, { reasoningEffort: 'max', capabilities: { reasoningEffortLevels: ['max'] } }), /模型列表未确认/);
  const selected = editModel(unknown.id, { reasoningEffort: 'low' });
  assert.equal(selected.reasoningEffort, 'low');
  assert.equal((sqlite().prepare('SELECT reasoning_effort FROM models WHERE id=?').get(unknown.id) as { reasoning_effort: string }).reasoning_effort, 'low');
  const followed = editModel(unknown.id, { reasoningEffort: null });
  assert.equal(followed.reasoningEffort, null);
});

test('thinking-off requires trusted discovery and official DeepSeek discovery permits saving it', async t => {
  const connection = addConnection({ name: 'Official DeepSeek fixture', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'fixture-key' });
  const input = { connectionId: connection.id, name: 'Fixture', modelId: 'arbitrary-model-id', reasoningEffort: 'none', capabilities: { reasoningEffortLevels: ['none'] } };
  assert.throws(() => addModel(input), /模型列表未确认/);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: [{ id: input.modelId, effort: { supported_levels: ['low', 'high'], default_level: 'high' } }] }));
  const request = new Request(`http://localhost/api/connections/${connection.id}/available-models`, { headers: { Authorization: `Bearer ${issueToken()}` } });
  assert.equal((await availableModels(request, { params: Promise.resolve({ id: connection.id }) })).status, 200);
  const saved = addModel(input);
  assert.equal(saved.reasoningEffort, 'none');
  assert.deepEqual(saved.capabilities?.reasoningEffortLevels, ['none', 'low', 'high']);
  assert.equal(listModels().find(model => model.id === saved.id)?.reasoningEffort, 'none');
  assert.equal(editModel(saved.id, { reasoningEffort: null }).reasoningEffort, null);
  assert.equal(editModel(saved.id, { reasoningEffort: 'none' }).reasoningEffort, 'none');
  editConnection(connection.id, { baseUrl: 'https://proxy.example/v1' });
  assert.equal(listModels().find(model => model.id === saved.id)?.reasoningEffort, null);
  assert.throws(() => editModel(saved.id, { reasoningEffort: 'none' }), /模型列表未确认/);
});

test('successful refreshed list clears unsupported choice; truncated list preserves unlisted models', () => {
  const connection = addConnection({ name: 'Paging', provider: 'anthropic', apiKey: 'fixture-key' });
  recordDiscoveredEffort(connection.id, { truncated: false, models: [{ id: 'claude-a', name: 'A', capabilities: { reasoningEffortLevels: ['low', 'high'] } }, { id: 'claude-b', name: 'B', capabilities: { reasoningEffortLevels: ['high'] } }] });
  const a = addModel({ connectionId: connection.id, name: 'A', modelId: 'claude-a', reasoningEffort: 'low' });
  const b = addModel({ connectionId: connection.id, name: 'B', modelId: 'claude-b', reasoningEffort: 'high' });
  recordDiscoveredEffort(connection.id, { truncated: true, models: [{ id: 'claude-a', name: 'A', capabilities: { reasoningEffortLevels: ['high'] } }] });
  assert.equal(listModels().find(model => model.id === a.id)?.reasoningEffort, null);
  assert.equal(listModels().find(model => model.id === b.id)?.reasoningEffort, 'high');
  recordDiscoveredEffort(connection.id, { truncated: false, models: [{ id: 'claude-a', name: 'A' }] });
  assert.equal(listModels().find(model => model.id === b.id)?.reasoningEffort, null);
  assert.throws(() => editModel(a.id, { reasoningEffort: 'high' }), /模型列表未确认/);
});

test('model or connection identity change clears selected effort and connection credentials invalidate discovery', () => {
  const connection = addConnection({ name: 'Identity', provider: 'openai', apiKey: 'fixture-key' });
  recordDiscoveredEffort(connection.id, { truncated: false, models: [{ id: 'model-a', name: 'A', capabilities: { reasoningEffortLevels: ['high'] } }] });
  const saved = addModel({ connectionId: connection.id, name: 'A', modelId: 'model-a', reasoningEffort: 'high' });
  assert.equal(editModel(saved.id, { modelId: 'model-b' }).reasoningEffort, null);
  assert.equal(editModel(saved.id, { modelId: 'model-a', reasoningEffort: 'high' }).reasoningEffort, 'high');
  editConnection(connection.id, { apiKey: 'changed-key' });
  assert.equal(listModels().find(model => model.id === saved.id)?.reasoningEffort, null);
  assert.throws(() => editModel(saved.id, { reasoningEffort: 'high' }), /模型列表未确认/);
});

test('a connection changed while listing models cannot store stale effort metadata', async t => {
  const connection = addConnection({ name: 'Race', provider: 'openai-compatible', baseUrl: 'https://fixture.example/v1', apiKey: 'first-key' });
  t.mock.method(globalThis, 'fetch', async () => {
    editConnection(connection.id, { apiKey: 'second-key' });
    return Response.json({ data: [{ id: 'model-race', effort: { supported_levels: ['high'] } }] });
  });
  const request = new Request(`http://localhost/api/connections/${connection.id}/available-models`, { headers: { Authorization: `Bearer ${issueToken()}` } });
  const response = await availableModels(request, { params: Promise.resolve({ id: connection.id }) });
  assert.equal(response.status, 409);
  assert.equal((sqlite().prepare('SELECT count(*) AS n FROM discovered_effort WHERE connection_id=?').get(connection.id) as { n: number }).n, 0);
});
