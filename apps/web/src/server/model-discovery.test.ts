import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Provider } from '@sayseed/shared';
import { fetchProviderModels } from './model-discovery';
import { ApiError } from './http';
import { resetDatabaseForTests, sqlite } from './db';
import { encrypt, issueToken, resetSecretForTests } from './security';
import { GET } from '../app/api/connections/[id]/available-models/route';

const dataDir = mkdtempSync(join(tmpdir(), 'sayseed-discovery-'));
const fakeKey = 'fixture-secret-key-never-log';
before(() => {
  process.env.SAYSEED_DATA_DIR = dataDir;
  process.env.SAYSEED_PASSWORD = 'test-password';
  resetSecretForTests(); resetDatabaseForTests();
});
after(() => { resetDatabaseForTests(); resetSecretForTests(); rmSync(dataDir, { recursive: true, force: true }); });

function connection(provider: Provider, baseUrl = '') { return { provider, baseUrl, apiKey: fakeKey }; }
function page(data: unknown, init?: ResponseInit): Response { return Response.json(data, init); }
function assertApiError(error: unknown, status: number): boolean {
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, status);
  assert.ok(!error.message.includes(fakeKey));
  return true;
}

test('provider endpoints use expected default paths, headers, and no credential in Google URL', async t => {
  const calls: { url: URL; headers: Headers; redirect: RequestRedirect }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), headers: new Headers(init?.headers), redirect: init?.redirect || 'follow' });
    return page(input.toString().includes('generativelanguage') ? { models: [] } : { data: [] });
  });
  for (const provider of ['openai', 'anthropic', 'google', 'openai-compatible'] as const) {
    await fetchProviderModels(connection(provider, provider === 'openai-compatible' ? 'https://proxy.example/v1' : ''));
  }
  assert.deepEqual(calls.map(call => call.url.origin + call.url.pathname), [
    'https://api.openai.com/v1/models', 'https://api.anthropic.com/v1/models',
    'https://generativelanguage.googleapis.com/v1beta/models', 'https://proxy.example/v1/models',
  ]);
  assert.equal(calls[0]!.headers.get('authorization'), `Bearer ${fakeKey}`);
  assert.equal(calls[1]!.headers.get('x-api-key'), fakeKey);
  assert.equal(calls[1]!.headers.get('anthropic-version'), '2023-06-01');
  assert.equal(calls[1]!.url.searchParams.get('limit'), '1000');
  assert.equal(calls[2]!.headers.get('x-goog-api-key'), fakeKey);
  assert.equal(calls[2]!.url.searchParams.get('pageSize'), '1000');
  assert.ok(!calls[2]!.url.href.includes(fakeKey));
  assert.equal(calls[3]!.headers.get('authorization'), `Bearer ${fakeKey}`);
  assert.ok(calls.every(call => call.redirect === 'manual'));
});

test('custom Anthropic and Google base URLs are respected; Anthropic unversioned official URL normalizes', async t => {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => { urls.push(String(input)); return page(String(input).includes('google') ? {} : { data: [] }); });
  await fetchProviderModels(connection('anthropic', 'https://api.anthropic.com'));
  await fetchProviderModels(connection('anthropic', 'https://anthropic.example/custom/v2/'));
  await fetchProviderModels(connection('google', 'https://google.example/custom/v1/'));
  assert.deepEqual(urls.map(value => new URL(value).pathname), ['/v1/models', '/custom/v2/models', '/custom/v1/models']);
});

test('Anthropic pagination deduplicates and sorts model IDs', async t => {
  const urls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); urls.push(url);
    return page(url.searchParams.has('after_id')
      ? { data: [{ id: 'a', display_name: 'Duplicate' }, { id: 'b', display_name: ' Bee ' }], has_more: false }
      : { data: [{ id: 'z', display_name: 'Zed' }, { id: 'a', display_name: 'Aye' }], has_more: true, last_id: 'a' });
  });
  const result = await fetchProviderModels(connection('anthropic'));
  assert.deepEqual(result.models.map(model => model.id), ['a', 'b', 'z']);
  assert.equal(result.models[0]!.name, 'Aye');
  assert.equal(result.models[1]!.name, 'Bee');
  assert.equal(urls[1]!.searchParams.get('after_id'), 'a');
  assert.equal(result.truncated, false);
});

test('Google pagination strips models/ prefix and omits non-generation models', async t => {
  const urls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); urls.push(url);
    return page(url.searchParams.has('pageToken')
      ? { models: [{ name: 'models/gemini-a', displayName: 'duplicate' }, { name: 'models/gemini-b', displayName: 'B' }] }
      : { models: [{ name: 'models/embedding-only', supportedGenerationMethods: ['embedContent'] }, { name: 'models/gemini-a', displayName: 'A', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'next' });
  });
  const result = await fetchProviderModels(connection('google'));
  assert.deepEqual(result.models.map(model => model.id), ['gemini-a', 'gemini-b']);
  assert.equal(result.models[0]!.name, 'A');
  assert.equal(urls[1]!.searchParams.get('pageToken'), 'next');
});

test('Google accepts an empty JSON object as an empty model list', async t => {
  t.mock.method(globalThis, 'fetch', async () => page({}));
  assert.deepEqual(await fetchProviderModels(connection('google')), { models: [], truncated: false });
});

test('OpenAI official list leaves unknown capabilities unset', async t => {
  t.mock.method(globalThis, 'fetch', async () => page({ data: [{ id: 'gpt-fixture', object: 'model', owned_by: 'openai' }] }));
  const result = await fetchProviderModels(connection('openai'));
  assert.deepEqual(result.models, [{ id: 'gpt-fixture', name: 'gpt-fixture' }]);
});

test('OpenAI Responses connection preserves explicit compatible metadata when a service returns it', async t => {
  t.mock.method(globalThis, 'fetch', async () => page({ data: [{ id: 'deepseek-fixture', input_modalities: ['text', 'image'], context_window: 1048576, max_output_tokens: 393216, effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' } }] }));
  const result = await fetchProviderModels(connection('openai', 'https://deepseek.example/v1'));
  assert.deepEqual(result.models[0]!.capabilities, { supportsImages: true, contextWindow: 1048576, maxOutputTokens: 393216, reasoningEffortLevels: ['low', 'high', 'max'], defaultReasoningEffort: 'high' });
});

test('Anthropic explicit image support and token limits are mapped without inventing total context', async t => {
  t.mock.method(globalThis, 'fetch', async () => page({ data: [
    { id: 'claude-vision', display_name: 'Claude Vision', capabilities: { image_input: { supported: true }, effort: { supported: true, low: { supported: true }, medium: { supported: false }, high: { supported: true }, xhigh: { supported: true }, max: { supported: false } } }, max_input_tokens: 200000, max_tokens: 64000 },
    { id: 'claude-text', capabilities: { image_input: { supported: false } }, max_input_tokens: 100000, max_tokens: 8192 },
  ] }));
  const result = await fetchProviderModels(connection('anthropic'));
  assert.deepEqual(result.models[0]!.capabilities, { supportsImages: false, maxInputTokens: 100000, maxOutputTokens: 8192 });
  assert.deepEqual(result.models[1]!.capabilities, { supportsImages: true, maxInputTokens: 200000, maxOutputTokens: 64000, reasoningEffortLevels: ['low', 'high', 'xhigh'] });
  assert.equal('contextWindow' in result.models[1]!.capabilities!, false);
});

test('Google maps separate input/output limits without claiming image support or total context', async t => {
  t.mock.method(globalThis, 'fetch', async () => page({ models: [
    { name: 'models/gemini-fixture', inputTokenLimit: 1048576, outputTokenLimit: 8192, supportedGenerationMethods: ['generateContent'], thinking: true },
  ] }));
  const result = await fetchProviderModels(connection('google'));
  assert.deepEqual(result.models[0]!.capabilities, { maxInputTokens: 1048576, maxOutputTokens: 8192 });
});

test('OpenAI-compatible DeepSeek metadata maps modalities, total context and output ceiling', async t => {
  t.mock.method(globalThis, 'fetch', async () => page({ data: [
    { id: 'deepseek-image', name: 'DeepSeek Image', input_modalities: ['text', 'image'], context_window: 1048576, max_output_tokens: 393216, effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' } },
    { id: 'deepseek-text', input_modalities: ['text'], context_window: 65536, max_output_tokens: 8192 },
  ] }));
  const result = await fetchProviderModels(connection('openai-compatible', 'https://deepseek.example/v1'));
  assert.deepEqual(result.models[0]!.capabilities, { supportsImages: true, contextWindow: 1048576, maxOutputTokens: 393216, reasoningEffortLevels: ['low', 'high', 'max'], defaultReasoningEffort: 'high' });
  assert.deepEqual(result.models[1]!.capabilities, { supportsImages: false, contextWindow: 65536, maxOutputTokens: 8192 });
});

test('only official DeepSeek model endpoints supplement the documented thinking-off option', async t => {
  t.mock.method(globalThis, 'fetch', async () => page({ data: [
    { id: 'arbitrary-model-id', effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' } },
    { id: 'without-effort' },
    { id: 'empty-effort', effort: { supported_levels: [] } },
  ] }));
  for (const provider of ['openai', 'openai-compatible'] as const) {
    for (const baseUrl of ['https://api.deepseek.com', 'https://api.deepseek.com/v1/']) {
      const result = await fetchProviderModels(connection(provider, baseUrl));
      assert.deepEqual(result.models.find(model => model.id === 'arbitrary-model-id')?.capabilities,
        { reasoningEffortLevels: ['none', 'low', 'high', 'max'], defaultReasoningEffort: 'high' });
      assert.equal(result.models.find(model => model.id === 'without-effort')?.capabilities, undefined);
      assert.equal(result.models.find(model => model.id === 'empty-effort')?.capabilities, undefined);
    }
    for (const baseUrl of ['http://api.deepseek.com', 'https://api.deepseek.com:444', 'https://api.deepseek.com/proxy', 'https://api.deepseek.com.example/v1', 'https://proxy.example/v1']) {
      const result = await fetchProviderModels(connection(provider, baseUrl));
      assert.deepEqual(result.models.find(model => model.id === 'arbitrary-model-id')?.capabilities?.reasoningEffortLevels, ['low', 'high', 'max']);
    }
  }
});

test('compatible services can explicitly declare none without granting it to unknown models', async t => {
  t.mock.method(globalThis, 'fetch', async () => page({ data: [
    { id: 'supported', effort: { supported_levels: ['none', 'low', 'none'], default_level: 'none' } },
    { id: 'unknown' },
  ] }));
  for (const provider of ['openai', 'openai-compatible'] as const) {
    const result = await fetchProviderModels(connection(provider, 'https://proxy.example/v1'));
    assert.deepEqual(result.models.find(model => model.id === 'supported')?.capabilities,
      { reasoningEffortLevels: ['none', 'low'], defaultReasoningEffort: 'none' });
    assert.equal(result.models.find(model => model.id === 'unknown')?.capabilities, undefined);
  }
});

test('malformed optional capability values are ignored without dropping valid models', async t => {
  t.mock.method(globalThis, 'fetch', async () => page({ data: [
    { id: 'bad', input_modalities: ['text', 7], context_window: '1048576', max_output_tokens: -2, effort: { supported_levels: ['invalid-effort', 4], default_level: 'invalid-effort' } },
    { id: 'huge', input_modalities: [], context_window: Number.MAX_SAFE_INTEGER + 1, max_output_tokens: 0 },
  ] }));
  const result = await fetchProviderModels(connection('openai-compatible', 'https://proxy.example/v1'));
  assert.deepEqual(result.models, [{ id: 'bad', name: 'bad' }, { id: 'huge', name: 'huge' }]);
  t.mock.reset();
  t.mock.method(globalThis, 'fetch', async () => page({ data: [{ id: 'claude-invalid', capabilities: { image_input: { supported: 'yes' } }, max_input_tokens: '200000', max_tokens: null }] }));
  assert.deepEqual((await fetchProviderModels(connection('anthropic'))).models, [{ id: 'claude-invalid', name: 'claude-invalid' }]);
  t.mock.reset();
  t.mock.method(globalThis, 'fetch', async () => page({ models: [{ name: 'models/google-invalid', inputTokenLimit: -1, outputTokenLimit: '8192' }] }));
  assert.deepEqual((await fetchProviderModels(connection('google'))).models, [{ id: 'google-invalid', name: 'google-invalid' }]);
  t.mock.reset();
  t.mock.method(globalThis, 'fetch', async () => page({ data: [{ id: 'effort-invalid-default', effort: { supported_levels: ['low', 'high', 'invalid-effort', 5], default_level: 'max' } }] }));
  assert.deepEqual((await fetchProviderModels(connection('openai-compatible', 'https://proxy.example/v1'))).models[0]!.capabilities, { reasoningEffortLevels: ['low', 'high'] });
});

test('Google rejects a different provider list shape instead of treating it as empty', async t => {
  t.mock.method(globalThis, 'fetch', async () => page({ data: [{ id: 'not-google-shape' }] }));
  await assert.rejects(fetchProviderModels(connection('google')), error => assertApiError(error, 502));
});

test('malformed, unauthorized, unsupported, and redirected upstream responses become safe gateway errors', async t => {
  const cases: Array<[Response, number]> = [
    [new Response(`{ "secret": "${fakeKey}"`, { status: 200 }), 502],
    [page({ error: fakeKey }), 502],
    [page({ data: {} }), 502],
    [new Response(fakeKey, { status: 401 }), 502],
    [new Response(fakeKey, { status: 404 }), 502],
    [new Response(fakeKey, { status: 302, headers: { Location: 'https://evil.example/' } }), 502],
  ];
  for (const [response, status] of cases) {
    t.mock.method(globalThis, 'fetch', async () => response);
    await assert.rejects(fetchProviderModels(connection('openai')), error => assertApiError(error, status));
    t.mock.reset();
  }
});

test('repeated pagination cursor fails safely and page count is bounded', async t => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => { count++; return page({ data: [{ id: `m-${count}` }], has_more: true, last_id: 'same' }); });
  await assert.rejects(fetchProviderModels(connection('openai')), error => assertApiError(error, 502));
  assert.equal(count, 2);
  t.mock.reset(); count = 0;
  t.mock.method(globalThis, 'fetch', async () => { count++; return page({ data: [{ id: `m-${count}` }], has_more: true, last_id: String(count) }); });
  const result = await fetchProviderModels(connection('openai'));
  assert.equal(count, 20);
  assert.equal(result.models.length, 20);
  assert.equal(result.truncated, true);
});

test('caller cancellation and declared oversized responses are bounded', async t => {
  const controller = new AbortController(); controller.abort();
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.signal?.aborted, true);
    throw new DOMException('cancelled', 'AbortError');
  });
  await assert.rejects(fetchProviderModels(connection('openai'), controller.signal), error => assertApiError(error, 499));
  t.mock.reset();
  t.mock.method(globalThis, 'fetch', async () => new Response('x', { headers: { 'content-length': String(4 * 1024 * 1024 + 1) } }));
  await assert.rejects(fetchProviderModels(connection('openai')), error => assertApiError(error, 502));
  t.mock.reset();
  t.mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)));
  await assert.rejects(fetchProviderModels(connection('openai')), error => assertApiError(error, 502));
});

test('route requires auth before fetching and reads encrypted key without changing configured models', async t => {
  let fetchCount = 0;
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    fetchCount++;
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${fakeKey}`);
    return page({ data: [{ id: 'new-model' }] });
  });
  const unauth = await GET(new Request('http://localhost/api/connections/c1/available-models'), { params: Promise.resolve({ id: 'c1' }) });
  assert.equal(unauth.status, 401);
  assert.equal(fetchCount, 0);
  const token = issueToken();
  const request = (id: string) => new Request(`http://localhost/api/connections/${id}/available-models`, { headers: { Authorization: `Bearer ${token}` } });
  const missing = await GET(request('missing'), { params: Promise.resolve({ id: 'missing' }) });
  assert.equal(missing.status, 404); assert.equal(fetchCount, 0);
  sqlite().prepare('INSERT INTO connections (id,name,provider,base_url,encrypted_key) VALUES (?,?,?,?,?)').run('c1', 'fixture', 'openai', '', encrypt(fakeKey));
  sqlite().prepare('INSERT INTO models (id,connection_id,name,model_id,supports_images,is_default) VALUES (?,?,?,?,?,?)').run('stored', 'c1', 'Stored', 'stored-model', 0, 1);
  const response = await GET(request('c1'), { params: Promise.resolve({ id: 'c1' }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await response.json()).models.map((model: { id: string }) => model.id), ['new-model']);
  assert.equal(fetchCount, 1);
  assert.equal((sqlite().prepare('SELECT model_id FROM models WHERE id=?').get('stored') as { model_id: string }).model_id, 'stored-model');
});
