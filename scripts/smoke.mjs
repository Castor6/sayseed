// Run only against an isolated QA instance with a temporary data directory.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.SAYSEED_SMOKE_URL || 'http://127.0.0.1:3100';
const mock = process.env.SAYSEED_MOCK_URL || 'http://127.0.0.1:4318';
const password = process.env.SAYSEED_SMOKE_PASSWORD;
assert(password, 'Set SAYSEED_SMOKE_PASSWORD for the isolated QA instance');
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Smoke tests must target a local isolated instance');
let token = '';
const connections = [];
const notes = [];
let browserQaConnectionId = '';
let checked = 0;
async function call(path, method = 'GET', body, expected = 200, authenticated = true) {
  const response = await fetch(`${base}/api${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(authenticated && token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  assert(Array.isArray(expected) ? expected.includes(response.status) : response.status === expected, `${method} ${path}: HTTP ${response.status} ${JSON.stringify(data)}`);
  checked++;
  return data;
}
async function translate(modelId, context = { mode: 'post', ancestors: [], incompleteReasons: [] }, expectError = false) {
  const response = await fetch(`${base}/api/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ draft: '我还没试过，但想读一下源码。', context, modelId }) });
  assert.equal(response.status, 200, await response.clone().text());
  const raw = await response.text();
  const events = raw.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  if (expectError) {
    assert(events.some(event => event.type === 'error'), raw);
    assert(!events.some(event => event.type === 'done'), raw);
    checked++;
    return;
  }
  assert(!events.some(event => event.type === 'error'), raw);
  const done = events.find(event => event.type === 'done');
  assert(done, raw);
  checked++;
  return done;
}
async function mockRequests() { return fetch(`${mock}/requests`).then(response => response.json()); }
async function setEffortListMode(mode) {
  const response = await fetch(`${mock}/fixture/list-mode`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-fixture-control': 'fixture-control-key' }, body: JSON.stringify({ mode }) });
  assert.equal(response.status, 200, `Could not set fixture mode to ${mode}`);
}
try {
  await setEffortListMode('normal');
  const mockRequestStart = (await mockRequests()).length;
  for (const path of ['/models', '/connections', '/notes', '/review', '/export', '/usage', '/prompts']) await call(path, 'GET', undefined, 401, false);
  const session = await call('/session', 'GET', undefined, 200, false);
  assert.equal(session.authenticated, false);
  assert.equal(session.configured, true);
  token = (await call('/auth/login', 'POST', { password }, 200, false)).token;
  assert(token);
  const extensionLogin = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, body: JSON.stringify({ password }) });
  assert.equal(extensionLogin.status, 200, 'A first-time Chrome extension login must succeed');
  const crossSiteWrite = await fetch(`${base}/api/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example', Cookie: `sayseed_session=${token}` }, body: '{}' });
  assert.equal(crossSiteWrite.status, 403, 'Cross-site cookie writes must be rejected');
  checked += 2;
  for (const provider of ['openai-compatible', 'anthropic']) {
    const connection = (await call('/connections', 'POST', { name: `Protocol QA ${provider}`, provider, baseUrl: provider === 'anthropic' ? `${mock}/anthropic/v1` : `${mock}/v1`, apiKey: 'fixture-only-key' }, [200, 201])).connection;
    connections.push(connection.id);
    assert(!JSON.stringify(connection).includes('fixture-only-key'));
    const available = await call(`/connections/${connection.id}/available-models`);
    assert.equal(available.truncated, false);
    assert.deepEqual(available.models.map(item => item.id), provider === 'anthropic'
      ? ['fixture-anthropic-alpha', 'fixture-anthropic-beta']
      : ['fixture-compatible-alpha', 'fixture-compatible-beta', 'fixture-deepseek-reasoner']);
    const capabilities = available.models[0].capabilities;
    assert.deepEqual(capabilities, provider === 'anthropic'
      ? { supportsImages: true, maxInputTokens: 200000, maxOutputTokens: 8192, reasoningEffortLevels: ['low', 'high', 'xhigh'] }
      : { supportsImages: true, contextWindow: 1048576, maxOutputTokens: 393216 });
    const model = (await call('/models', 'POST', { connectionId: connection.id, name: `Protocol QA ${provider}`, modelId: 'fixture-translation', capabilities }, [200, 201])).model;
    assert.equal(model.supportsImages, true);
    const savedCapabilities = provider === 'anthropic'
      ? { supportsImages: true, maxInputTokens: 200000, maxOutputTokens: 8192 }
      : capabilities;
    assert.deepEqual(model.capabilities, savedCapabilities);
    const renamed = (await call(`/models/${model.id}`, 'PATCH', { name: 'Renamed protocol model' })).model;
    assert.deepEqual(renamed.capabilities, savedCapabilities);
    assert.equal(renamed.isDefault, model.isDefault);
    const done = await translate(model.id);
    assert.equal(done.kind, 'translation');
    assert.match(done.text, /look through the code/);
    await call(`/models/${model.id}/test`, 'POST', {});
    const { explanation } = await call('/explain', 'POST', { selection: 'buy', sentence: "I don't quite buy that argument yet.", modelId: model.id });
    assert.match(explanation.meaning, /相信/);
    const modelListing = await call('/models');
    assert(modelListing.models.some(item => item.id === model.id));
    const effortModelId = provider === 'anthropic' ? 'fixture-anthropic-alpha' : 'fixture-deepseek-reasoner';
    const effortCapabilities = available.models.find(item => item.id === effortModelId)?.capabilities;
    const effort = provider === 'anthropic' ? 'xhigh' : 'high';
    assert(effortCapabilities?.reasoningEffortLevels.includes(effort));
    if (provider === 'openai-compatible') assert.equal(effortCapabilities.defaultReasoningEffort, 'high');
    const effortModel = (await call('/models', 'POST', { connectionId: connection.id, name: `Effort QA ${provider}`, modelId: effortModelId, capabilities: effortCapabilities }, [200, 201])).model;
    assert.equal(effortModel.reasoningEffort, null);
    const beforeDefault = (await mockRequests()).length;
    await call(`/models/${effortModel.id}/test`, 'POST', {});
    const defaultRequest = (await mockRequests()).slice(beforeDefault).find(request => request.model === effortModelId && !request.listing);
    assert(defaultRequest);
    assert.equal(defaultRequest.reasoningEffort, undefined);
    assert.equal(defaultRequest.anthropicEffort, undefined);
    const selected = (await call(`/models/${effortModel.id}`, 'PATCH', { reasoningEffort: effort })).model;
    assert.equal(selected.reasoningEffort, effort);
    assert.deepEqual(selected.capabilities.reasoningEffortLevels, effortCapabilities.reasoningEffortLevels);
    const beforeExplicit = (await mockRequests()).length;
    await call(`/models/${effortModel.id}/test`, 'POST', {});
    const effortExplanation = await call('/explain', 'POST', { selection: 'buy', sentence: "I don't quite buy that argument yet.", modelId: effortModel.id });
    assert.match(effortExplanation.explanation.meaning, /相信/);
    assert.equal((await translate(effortModel.id)).kind, 'translation');
    const explicitRequests = (await mockRequests()).slice(beforeExplicit).filter(request => request.model === effortModelId && !request.listing);
    assert.equal(explicitRequests.length, 3);
    assert.deepEqual(explicitRequests.map(request => request.stream), [false, false, true]);
    for (const request of explicitRequests) {
      assert.equal(provider === 'anthropic' ? request.anthropicEffort : request.reasoningEffort, effort);
      if (provider === 'anthropic') assert.equal(request.anthropicThinking, undefined);
    }
    await setEffortListMode('changed');
    const refreshed = await call(`/connections/${connection.id}/available-models`);
    const changedCapabilities = refreshed.models.find(item => item.id === effortModelId)?.capabilities;
    assert(changedCapabilities);
    assert(!changedCapabilities.reasoningEffortLevels.includes(effort));
    const afterRefresh = await call('/models');
    const resetModel = afterRefresh.models.find(item => item.id === effortModel.id);
    assert.equal(resetModel.reasoningEffort, null);
    assert.deepEqual(resetModel.capabilities.reasoningEffortLevels, changedCapabilities.reasoningEffortLevels);
    await call(`/models/${effortModel.id}`, 'PATCH', { reasoningEffort: effort }, 400);
    await setEffortListMode('normal');
    await call(`/connections/${connection.id}/available-models`);
    if (provider === 'openai-compatible') {
      const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=';
      await translate(model.id, { mode: 'reply', target: { text: 'What do you think?', images: [image] }, ancestors: [], incompleteReasons: [] });
      const clarification = (await call('/models', 'POST', { connectionId: connection.id, name: 'Clarification QA', modelId: 'fixture-clarify', supportsImages: false }, [200, 201])).model;
      const clarified = await translate(clarification.id);
      assert.equal(clarified.kind, 'clarification');
      const textOnly = await translate(clarification.id, { mode: 'reply', target: { text: 'Image', images: [image] }, ancestors: [], incompleteReasons: [] });
      assert.equal(textOnly.kind, 'clarification');
      const failure = (await call('/models', 'POST', { connectionId: connection.id, name: 'Failure QA', modelId: 'fixture-fail' }, [200, 201])).model;
      await translate(failure.id, undefined, true);
      const truncated = (await call('/models', 'POST', { connectionId: connection.id, name: 'Truncated QA', modelId: 'fixture-truncated' }, [200, 201])).model;
      await translate(truncated.id, undefined, true);
    }
  }
  for (const [provider, path, expected] of [
    ['openai', '/openai/v1', ['fixture-openai-alpha', 'fixture-openai-beta']],
    ['google', '/google/v1', ['fixture-google-alpha', 'fixture-google-beta']],
  ]) {
    const connection = (await call('/connections', 'POST', { name: `Model list QA ${provider}`, provider, baseUrl: `${mock}${path}`, apiKey: 'fixture-only-key' }, [200, 201])).connection;
    connections.push(connection.id);
    const available = await call(`/connections/${connection.id}/available-models`);
    assert.equal(available.truncated, false);
    assert.deepEqual(available.models.map(item => item.id), expected);
    if (provider === 'google') {
      assert.deepEqual(available.models[0].capabilities, { maxInputTokens: 32768, maxOutputTokens: 8192 });
      assert.equal(available.models[1].description, 'Second page');
      assert(!available.models.some(item => item.id.includes('embedding')));
    } else assert.equal(available.models[0].capabilities, undefined);
  }
  const emptyGoogle = (await call('/connections', 'POST', { name: 'Empty Google QA', provider: 'google', baseUrl: `${mock}/google/empty/v1`, apiKey: 'fixture-only-key' }, [200, 201])).connection;
  connections.push(emptyGoogle.id);
  const emptyAvailable = await call(`/connections/${emptyGoogle.id}/available-models`);
  assert.deepEqual(emptyAvailable.models, []);
  assert.equal(emptyAvailable.truncated, false);
  await call('/connections/unknown-fixture-id/available-models', 'GET', undefined, 404);
  await call(`/connections/${emptyGoogle.id}/available-models`, 'GET', undefined, 401, false);
  for (const [name, baseUrl] of [['Malformed', `${mock}/malformed/v1`], ['Unsupported', `${mock}/unsupported/v1`]]) {
    const connection = (await call('/connections', 'POST', { name: `${name} list QA`, provider: 'openai-compatible', baseUrl, apiKey: 'fixture-only-key' }, [200, 201])).connection;
    connections.push(connection.id);
    await call(`/connections/${connection.id}/available-models`, 'GET', undefined, [400, 502]);
  }
  const noteInput = { expression: 'buy', sentence: "I don't quite buy that argument yet.", meaning: '相信、接受某种说法', sentenceTranslation: '我目前还不太信服这个说法。', usage: '用于表达有所保留。', sourceKind: 'webpage', sourceUrl: `https://example.com/sayseed-qa/${randomUUID()}`, sourceTitle: 'Protocol QA' };
  const saved = await call('/notes', 'POST', noteInput, [200, 201]);
  notes.push(saved.note.id);
  assert.equal(saved.duplicate, false);
  const duplicate = await call('/notes', 'POST', noteInput, [200, 201]);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.note.id, saved.note.id);
  const queue = await call('/review');
  const item = queue.items.find(value => value.note.id === saved.note.id);
  assert(item);
  const submission = { cardId: item.cardId, revision: item.revision, rating: 3, idempotencyKey: randomUUID() };
  const rated = await call('/review', 'POST', submission);
  const repeated = await call('/review', 'POST', submission);
  assert.equal(repeated.due, rated.due);
  await call('/review', 'POST', { ...submission, rating: 4 }, 409);
  await call('/review', 'POST', { ...submission, idempotencyKey: randomUUID() }, 409);
  await call(`/notes/${saved.note.id}`, 'PATCH', { suspended: true });
  const suspendedQueue = await call('/review');
  assert(!suspendedQueue.items.some(value => value.note.id === saved.note.id));
  const backup = await call('/export');
  assert.equal(backup.version, 1);
  assert(!JSON.stringify(backup).includes('fixture-only-key'));
  const browserQaConnection = (await call('/connections', 'POST', { name: 'Browser QA Reasoning Fixture', provider: 'openai-compatible', baseUrl: `${mock}/v1`, apiKey: 'fixture-only-key' }, [200, 201])).connection;
  browserQaConnectionId = browserQaConnection.id;
  connections.push(browserQaConnection.id);
  const browserQaAvailable = await call(`/connections/${browserQaConnection.id}/available-models`);
  assert(browserQaAvailable.models.some(item => item.id === 'fixture-deepseek-reasoner'));
  const browserQaModel = (await call('/models', 'POST', { connectionId: browserQaConnection.id, name: 'Browser QA DeepSeek Effort', modelId: 'fixture-deepseek-reasoner', reasoningEffort: 'low' }, [200, 201])).model;
  assert.equal(browserQaModel.reasoningEffort, 'low');
  const observed = (await mockRequests()).slice(mockRequestStart);
  assert(observed.some(request => request.path.includes('/chat/completions') && request.stream));
  assert(observed.some(request => request.path.includes('/messages') && request.stream));
  assert(!observed.some(request => request.hasImage));
  assert(observed.some(request => request.path.includes('after_id=fixture-anthropic-alpha')));
  assert(observed.some(request => request.path.includes('pageToken=fixture-page-two')));
  const usage = await call('/usage?limit=100');
  assert(usage.total >= 18);
  assert.equal(usage.summary.calls, usage.total);
  for (const purpose of ['translate', 'explain', 'test']) assert(usage.items.some(item => item.purpose === purpose));
  assert(usage.items.some(item => item.status === 'success' && item.totalTokens === 30));
  assert(usage.items.some(item => item.errorCode === 'incomplete' && item.totalTokens === 30));
  assert(usage.items.some(item => item.errorCode === 'provider_error' && item.totalTokens === null));
  assert(!JSON.stringify(usage).includes('fixture-only-key'));
  const failedUsage = await call('/usage?status=error&purpose=translate&limit=1');
  assert.equal(failedUsage.items.length, 1);
  assert(failedUsage.total >= 2);
  assert.equal(failedUsage.summary.calls, failedUsage.total);
  assert(failedUsage.items.every(item => item.status === 'error' && item.purpose === 'translate'));
  const modelUsage = await call(`/usage?modelId=${failedUsage.items[0].modelRecordId}`);
  assert(modelUsage.items.every(item => item.modelRecordId === failedUsage.items[0].modelRecordId));
  assert(usage.items.every(item => !('context' in item) && !('context_json' in item)));
  const translatedUsage = usage.items.find(item => item.purpose === 'translate' && item.status === 'success');
  assert(translatedUsage);
  const detail = await call(`/usage/${translatedUsage.id}`);
  assert.equal(detail.record.id, translatedUsage.id);
  assert(detail.context.system.includes('不要仅凭“发帖”或“评论”决定语气'));
  assert(detail.context.system.includes('CLARIFY:'));
  assert(detail.context.messages[0].content.some(part => part.type === 'text' && part.text.includes('我还没试过，但想读一下源码。')));
  assert(detail.context.output.text.length > 0);
  assert(!JSON.stringify(detail).includes('fixture-only-key'));
  await call(`/usage/${translatedUsage.id}`, 'GET', undefined, 401, false);
  await call('/usage/missing-record', 'GET', undefined, 404);
  await call('/usage?limit=101', 'GET', undefined, 400);
  const promptSettings = await call('/prompts');
  assert.deepEqual(promptSettings.prompts.map(prompt => prompt.kind).sort(), ['explain', 'translate']);
  await call('/prompts/test', 'GET', undefined, 400);
  for (const original of promptSettings.prompts) {
    const path = `/prompts/${original.kind}`;
    const customBody = original.kind === 'translate' ? '忠实表达原意，使用自然英文。HTTP 联调测试。' : '用简洁中文解释选中表达在原句中的含义。HTTP 联调测试。';
    const draft = { mode: 'custom', body: customBody };
    const version = { revision: original.revision, defaultVersion: original.defaultVersion, protocolVersion: original.protocolVersion };
    const beforePreview = (await mockRequests()).length;
    const preview = await call(`${path}/preview`, 'POST', draft);
    assert.equal((await mockRequests()).length, beforePreview, 'Preview must not call a model');
    assert.equal((await call(path)).prompt.revision, original.revision, 'Preview must not save a draft');
    try {
      const configured = (await call(path, 'PATCH', { ...draft, ...version })).prompt;
      assert.equal(configured.system, preview.system);
      assert.equal(configured.revision, original.revision + 1);
      await call(path, 'PATCH', { ...draft, ...version }, 409);
      const history = await call(`${path}/history?limit=2&offset=0`);
      assert.equal(history.items[0].body, customBody);
      assert.equal(history.items[0].revision, configured.revision);
      if (original.kind === 'translate') await translate(browserQaModel.id);
      else await call('/explain', 'POST', { selection: 'buy', sentence: 'I do not buy that.', modelId: browserQaModel.id });
      const recent = await call(`/usage?purpose=${original.kind}&modelId=${browserQaModel.id}&limit=1`);
      const recorded = await call(`/usage/${recent.items[0].id}`);
      assert.equal(recorded.context.system, preview.system);
      assert.equal(recorded.context.prompt.revision, configured.revision);
      assert.equal(recorded.context.prompt.kind, original.kind);
      assert.equal(recorded.context.prompt.mode, 'custom');
      assert.equal(recorded.context.prompt.protocolVersion, configured.protocolVersion);
    } finally {
      const current = (await call(path)).prompt;
      const restored = (await call(path, 'PATCH', { mode: original.mode, ...(original.mode === 'custom' ? { body: original.body } : {}), revision: current.revision, defaultVersion: current.defaultVersion, protocolVersion: current.protocolVersion })).prompt;
      assert.equal(restored.system, original.system);
    }
  }
  console.log(`PASS: ${checked} HTTP checks, provider discovery, reasoning and prompt settings, generation, usage records, notes and idempotent review. Browser QA model: ${browserQaModel.name} (${browserQaModel.id}).`);
} finally {
  await setEffortListMode('normal').catch(console.error);
  for (const id of notes) await call(`/notes/${id}`, 'DELETE').catch(console.error);
  for (const id of connections) if (id !== browserQaConnectionId) await call(`/connections/${id}`, 'DELETE').catch(console.error);
}
