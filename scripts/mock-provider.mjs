// Local protocol fixture for integration tests. This is not a real model.
import { createServer } from 'node:http';

const port = Number(process.env.SAYSEED_MOCK_PORT || 4318);
const translation = "I haven't tried it yet, but I'd like to look through the code.";
const explanation = JSON.stringify({ meaning: '相信、接受某种说法', sentenceTranslation: '我目前还不太信服这个说法。', usage: 'buy an argument 表示接受某种论点，语气较口语化。' });
const requests = [];
let effortListMode = 'normal';
function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}
const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/requests') {
    json(response, 200, requests);
    return;
  }
  if (request.method === 'POST' && request.url === '/fixture/list-mode') {
    if (request.headers['x-fixture-control'] !== 'fixture-control-key') { json(response, 403, { error: 'Fixture control forbidden' }); return; }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    let mode;
    try { mode = JSON.parse(raw).mode; } catch { json(response, 400, { error: 'Invalid mode' }); return; }
    if (!['normal', 'changed'].includes(mode)) { json(response, 400, { error: 'Invalid mode' }); return; }
    effortListMode = mode;
    json(response, 200, { mode });
    return;
  }
  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
  if (request.method === 'GET' && url.pathname.endsWith('/models')) {
    const anthropicModels = url.pathname.startsWith('/anthropic/');
    const googleModels = url.pathname.startsWith('/google/');
    const authorized = anthropicModels
      ? request.headers['x-api-key'] === 'fixture-only-key' && request.headers['anthropic-version'] === '2023-06-01'
      : googleModels
        ? request.headers['x-goog-api-key'] === 'fixture-only-key'
        : request.headers.authorization === 'Bearer fixture-only-key';
    if (!authorized) { json(response, 401, { error: { message: 'Fixture key mismatch', type: 'authentication_error' } }); return; }
    requests.push({ path: request.url, method: 'GET', listing: true });
    if (url.pathname.startsWith('/unsupported/')) { json(response, 404, { error: 'Listing unsupported' }); return; }
    if (url.pathname.startsWith('/malformed/')) { json(response, 200, { unexpected: true }); return; }
    if (anthropicModels) {
      const secondPage = url.searchParams.get('after_id') === 'fixture-anthropic-alpha';
      json(response, 200, secondPage
        ? { data: [{ id: 'fixture-anthropic-beta', display_name: 'Anthropic Beta' }], has_more: false, last_id: 'fixture-anthropic-beta' }
        : { data: [{ id: 'fixture-anthropic-alpha', display_name: 'Anthropic Alpha', capabilities: { image_input: { supported: true }, effort: effortListMode === 'normal'
          ? { supported: true, low: { supported: true }, high: { supported: true }, xhigh: { supported: true } }
          : { supported: true, low: { supported: true }, high: { supported: true } } }, max_input_tokens: 200000, max_tokens: 8192 }], has_more: true, last_id: 'fixture-anthropic-alpha' });
      return;
    }
    if (googleModels) {
      if (url.pathname.startsWith('/google/empty/')) { json(response, 200, {}); return; }
      const secondPage = url.searchParams.get('pageToken') === 'fixture-page-two';
      json(response, 200, secondPage
        ? { models: [{ name: 'models/fixture-google-beta', displayName: 'Google Beta', description: 'Second page', supportedGenerationMethods: ['generateContent'] }] }
        : { models: [
            { name: 'models/fixture-google-alpha', displayName: 'Google Alpha', description: 'First page', inputTokenLimit: 32768, outputTokenLimit: 8192, supportedGenerationMethods: ['generateContent'] },
            { name: 'models/fixture-google-embedding', displayName: 'Embedding Only', supportedGenerationMethods: ['embedContent'] },
          ], nextPageToken: 'fixture-page-two' });
      return;
    }
    if (url.pathname.startsWith('/openai/')) {
      json(response, 200, { object: 'list', data: [{ id: 'fixture-openai-alpha', object: 'model' }, { id: 'fixture-openai-beta', object: 'model' }] });
      return;
    }
    json(response, 200, { object: 'list', data: [
      { id: 'fixture-compatible-alpha', object: 'model', name: 'Vision Alpha', input_modalities: ['text', 'image'], context_window: 1048576, max_output_tokens: 393216 },
      { id: 'fixture-compatible-beta', object: 'model', name: 'Text Beta', input_modalities: ['text'], context_window: 65536, max_output_tokens: 8192 },
      { id: 'fixture-deepseek-reasoner', object: 'model', name: 'DeepSeek Reasoner', input_modalities: ['text'], context_window: 131072, max_output_tokens: 8192,
        effort: effortListMode === 'normal' ? { supported_levels: ['low', 'high', 'max'], default_level: 'high' } : { supported_levels: ['low', 'max'], default_level: 'max' } },
    ] });
    return;
  }
  let raw = '';
  for await (const chunk of request) raw += chunk;
  let body;
  try { body = JSON.parse(raw); } catch { response.writeHead(400).end(); return; }
  const anthropic = request.url?.includes('/messages');
  const authorized = anthropic ? request.headers['x-api-key'] === 'fixture-only-key' : request.headers.authorization === 'Bearer fixture-only-key';
  if (!authorized) {
    response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Fixture key mismatch', type: 'authentication_error' } }));
    return;
  }
  requests.push({ path: request.url, stream: !!body.stream, model: body.model, hasImage: /image_url|"type":"image"/.test(raw),
    reasoningEffort: body.reasoning_effort, anthropicEffort: body.output_config?.effort, anthropicThinking: body.thinking?.type });
  const text = body.model?.includes('clarify') ? 'CLARIFY: 这里是认真请教还是调侃？' : /sentenceTranslation/.test(raw) ? explanation : translation;
  if (body.model?.includes('fail')) {
    response.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Fixture unavailable', type: 'api_error' } }));
    return;
  }
  if (!body.stream) {
    const result = anthropic
      ? { id: 'msg_fixture', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 12, output_tokens: 18 } }
      : { id: 'chatcmpl_fixture', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 18, total_tokens: 30 } };
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    return;
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const emit = (data, event) => response.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`);
  if (anthropic) {
    emit({ type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } } }, 'message_start');
    emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, 'content_block_start');
  }
  for (let index = 0; index < text.length && !response.destroyed; index += 9) {
    const chunk = text.slice(index, index + 9);
    if (anthropic) emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk } }, 'content_block_delta');
    else emit({ id: 'chatcmpl_fixture', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }] });
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  if (!response.destroyed) {
    if (anthropic) {
      emit({ type: 'content_block_stop', index: 0 }, 'content_block_stop');
      emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 18 } }, 'message_delta');
      emit({ type: 'message_stop' }, 'message_stop');
    } else {
      emit({ id: 'chatcmpl_fixture', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: body.model?.includes('truncated') ? 'length' : 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 18, total_tokens: 30 } });
      response.write('data: [DONE]\n\n');
    }
    response.end();
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Protocol fixture listening on http://127.0.0.1:${port}`));
