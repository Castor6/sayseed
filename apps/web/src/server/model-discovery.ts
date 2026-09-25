import { reasoningEffortSchema, type DiscoveredModel, type DiscoveredModelsResult, type ModelCapabilities, type Provider } from '@sayseed/shared';
import { sqlite } from './db';
import { decrypt } from './security';
import { ApiError } from './http';

const DEFAULT_BASE_URLS: Partial<Record<Provider, string>> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
};
const MAX_PAGES = 20;
const MAX_MODELS = 5000;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const INVALID_LIST = '服务未返回有效的模型列表，可以手动填写模型 ID';
type JsonObject = Record<string, unknown>;

function object(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function positiveTokenLimit(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function effortLevels(value: unknown): ModelCapabilities['reasoningEffortLevels'] {
  if (!Array.isArray(value)) return;
  const levels = value.filter((item): item is NonNullable<ModelCapabilities['reasoningEffortLevels']>[number] => reasoningEffortSchema.safeParse(item).success);
  return levels.length ? [...new Set(levels)] : undefined;
}

function capabilitiesFromRow(row: JsonObject, provider: Provider, officialDeepSeek: boolean): ModelCapabilities {
  const result: ModelCapabilities = {};
  if (provider === 'anthropic') {
    const imageInput = object(row.capabilities) && object(row.capabilities.image_input) ? row.capabilities.image_input : undefined;
    if (typeof imageInput?.supported === 'boolean') result.supportsImages = imageInput.supported;
    result.maxInputTokens = positiveTokenLimit(row.max_input_tokens);
    result.maxOutputTokens = positiveTokenLimit(row.max_tokens);
    const effort = object(row.capabilities) && object(row.capabilities.effort) ? row.capabilities.effort : undefined;
    if (effort?.supported === true) {
      result.reasoningEffortLevels = effortLevels(['low', 'medium', 'high', 'xhigh', 'max'].filter(level => object(effort[level]) && effort[level].supported === true));
    }
  } else if (provider === 'google') {
    result.maxInputTokens = positiveTokenLimit(row.inputTokenLimit);
    result.maxOutputTokens = positiveTokenLimit(row.outputTokenLimit);
  } else if (provider === 'openai' || provider === 'openai-compatible') {
    if (Array.isArray(row.input_modalities) && row.input_modalities.length > 0 && row.input_modalities.every(value => typeof value === 'string')) {
      result.supportsImages = row.input_modalities.includes('image');
    }
    result.contextWindow = positiveTokenLimit(row.context_window);
    result.maxOutputTokens = positiveTokenLimit(row.max_output_tokens);
    const effort = object(row.effort) ? row.effort : undefined;
    if (effort) {
      result.reasoningEffortLevels = effortLevels(effort.supported_levels);
      // DeepSeek lists enabled-thinking levels only; its official API separately supports none.
      if (officialDeepSeek && result.reasoningEffortLevels?.length && !result.reasoningEffortLevels.includes('none')) {
        result.reasoningEffortLevels.unshift('none');
      }
      if (result.reasoningEffortLevels?.includes(effort.default_level as NonNullable<ModelCapabilities['reasoningEffortLevels']>[number])) {
        result.defaultReasoningEffort = effort.default_level as NonNullable<ModelCapabilities['reasoningEffortLevels']>[number];
      }
    }
  }
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
}

async function readPage(response: Response): Promise<JsonObject> {
  if (Number(response.headers.get('content-length') || 0) > MAX_PAGE_BYTES) {
    await response.body?.cancel();
    throw new ApiError(502, '模型列表响应过大，可以手动填写模型 ID');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(502, INVALID_LIST);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_PAGE_BYTES) throw new ApiError(502, '模型列表响应过大，可以手动填写模型 ID');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  let data: unknown;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(502, INVALID_LIST); }
  if (!object(data) || 'error' in data) throw new ApiError(502, INVALID_LIST);
  return data;
}

function modelFromRow(value: unknown, provider: Provider, officialDeepSeek: boolean): DiscoveredModel | null {
  if (!object(value)) throw new ApiError(502, INVALID_LIST);
  const rawId = provider === 'google' ? value.name : value.id;
  if (typeof rawId !== 'string' || !rawId.trim()) throw new ApiError(502, INVALID_LIST);
  const id = provider === 'google' ? rawId.trim().replace(/^models\//, '') : rawId.trim();
  // Keep returned IDs valid for the existing model form without changing them.
  if (!id || id.length > 200) return null;
  if (provider === 'google' && Array.isArray(value.supportedGenerationMethods) && !value.supportedGenerationMethods.includes('generateContent')) return null;
  const display = provider === 'google' ? value.displayName : provider === 'anthropic' ? value.display_name : value.name;
  const name = (typeof display === 'string' && display.trim() ? display.trim() : id).slice(0, 100);
  const description = typeof value.description === 'string' ? value.description.trim().slice(0, 1000) : '';
  const capabilities = capabilitiesFromRow(value, provider, officialDeepSeek);
  return { id, name, ...(description ? { description } : {}), ...(Object.keys(capabilities).length ? { capabilities } : {}) };
}

function cursorFromPage(data: JsonObject, provider: Provider): string | undefined {
  if (provider === 'google') {
    if (data.nextPageToken == null || data.nextPageToken === '') return;
    if (typeof data.nextPageToken === 'string' && data.nextPageToken.length <= 8192) return data.nextPageToken;
    throw new ApiError(502, INVALID_LIST);
  }
  if (data.has_more === undefined || data.has_more === false) return;
  if (data.has_more !== true || typeof data.last_id !== 'string' || !data.last_id || data.last_id.length > 8192) throw new ApiError(502, INVALID_LIST);
  return data.last_id;
}

export async function fetchProviderModels(connection: { provider: Provider; baseUrl: string; apiKey: string }, signal?: AbortSignal): Promise<DiscoveredModelsResult> {
  const { provider, apiKey } = connection;
  let baseUrl = connection.baseUrl.trim().replace(/\/+$/, '') || DEFAULT_BASE_URLS[provider];
  if (!baseUrl) throw new ApiError(400, 'OpenAI Chat Completions 需要填写接口地址');
  // Match the Anthropic SDK's normalization of its unversioned official URL.
  if (provider === 'anthropic' && baseUrl === 'https://api.anthropic.com') baseUrl += '/v1';
  let endpoint: URL;
  try {
    endpoint = new URL(`${baseUrl}/models`);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error();
  } catch { throw new ApiError(400, '请输入有效的 HTTP 或 HTTPS 接口地址'); }
  const officialDeepSeek = (provider === 'openai' || provider === 'openai-compatible') &&
    endpoint.origin === 'https://api.deepseek.com' && ['/models', '/v1/models'].includes(endpoint.pathname);
  if (!apiKey) throw new ApiError(400, '请先为此供应商保存 API 密钥');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01';
    endpoint.searchParams.set('limit', '1000');
  } else if (provider === 'google') {
    headers['x-goog-api-key'] = apiKey; endpoint.searchParams.set('pageSize', '1000');
  } else headers.Authorization = `Bearer ${apiKey}`;
  const timeout = AbortSignal.timeout(20000);
  const requestSignal = signal ? AbortSignal.any([timeout, signal]) : timeout;
  const found = new Map<string, DiscoveredModel>();
  const cursors = new Set<string>();
  let truncated = false;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      // Never forward credentials to a redirect destination supplied by a provider.
      const response = await fetch(endpoint, { headers, signal: requestSignal, redirect: 'manual', cache: 'no-store' });
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status)) throw new ApiError(502, '模型服务拒绝了查询，请检查 API 密钥及其权限');
        if ([404, 405, 501].includes(response.status)) throw new ApiError(502, '此服务未提供模型列表接口，可以手动填写模型 ID');
        if (response.status === 429) throw new ApiError(502, '模型列表查询过于频繁，请稍后重试');
        if (response.status >= 300 && response.status < 400) throw new ApiError(502, '接口地址发生重定向，请填写最终的 API 地址');
        throw new ApiError(502, `模型列表获取失败（服务返回 ${response.status}），可以稍后重试或手动填写`);
      }
      const data = await readPage(response);
      // Google omits empty repeated fields in its JSON responses.
      if (provider === 'google' && data.models === undefined && Object.keys(data).some(key => key !== 'nextPageToken')) throw new ApiError(502, INVALID_LIST);
      const rows = provider === 'google' ? data.models ?? [] : data.data;
      if (!Array.isArray(rows)) throw new ApiError(502, INVALID_LIST);
      for (const row of rows) {
        const model = modelFromRow(row, provider, officialDeepSeek);
        if (!model || found.has(model.id)) continue;
        if (found.size >= MAX_MODELS) { truncated = true; break; }
        found.set(model.id, model);
      }
      const cursor = cursorFromPage(data, provider);
      if (!cursor || truncated) break;
      if (cursors.has(cursor)) throw new ApiError(502, '服务返回了重复的分页结果，可以手动填写模型 ID');
      cursors.add(cursor);
      if (page === MAX_PAGES - 1 || found.size >= MAX_MODELS) { truncated = true; break; }
      endpoint.searchParams.set(provider === 'google' ? 'pageToken' : provider === 'anthropic' ? 'after_id' : 'after', cursor);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timeout.aborted) throw new ApiError(504, '模型列表查询超时，请稍后重试或手动填写模型 ID');
    if (signal?.aborted) throw new ApiError(499, '模型列表查询已取消');
    // Do not expose upstream bodies, URLs or transport errors that may contain credentials.
    throw new ApiError(502, '无法连接模型服务，请检查接口地址或稍后重试');
  }
  return { models: [...found.values()].sort((a, b) => a.id.localeCompare(b.id)), truncated };
}

export async function discoverConnectionModels(id: string, signal?: AbortSignal): Promise<DiscoveredModelsResult> {
  const row = sqlite().prepare('SELECT provider, base_url, encrypted_key FROM connections WHERE id=?').get(id) as { provider: Provider; base_url: string; encrypted_key: string } | undefined;
  if (!row) throw new ApiError(404, '供应商不存在');
  return fetchProviderModels({ provider: row.provider, baseUrl: row.base_url, apiKey: decrypt(row.encrypted_key) }, signal);
}
