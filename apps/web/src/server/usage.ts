import { randomUUID } from 'node:crypto';
import type { LanguageModelUsage } from 'ai';
import type { Model, Provider, UsageContext, UsageDetail, UsagePurpose, UsageRecord, UsageResult, UsageStatus, UsageTokenSummary } from '@sayseed/shared';
import { sqlite } from './db';
import { ApiError } from './http';

type TokenField = 'inputTokens' | 'outputTokens' | 'totalTokens' | 'reasoningTokens' | 'cacheReadTokens' | 'cacheWriteTokens';
const tokenColumns: Record<TokenField, string> = {
  inputTokens: 'input_tokens', outputTokens: 'output_tokens', totalTokens: 'total_tokens',
  reasoningTokens: 'reasoning_tokens', cacheReadTokens: 'cache_read_tokens', cacheWriteTokens: 'cache_write_tokens',
};

function safeToken(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function rawToken(usage: LanguageModelUsage | null | undefined, paths: string[][]): number | null {
  const raw = usage?.raw;
  if (!raw || typeof raw !== 'object') return null;
  for (const path of paths) {
    let value: unknown = raw;
    for (const key of path) value = value && typeof value === 'object' && key in value ? (value as Record<string, unknown>)[key] : undefined;
    const count = safeToken(value);
    if (count !== null) return count;
  }
  return null;
}
function detailToken(value: unknown, usage: LanguageModelUsage | null | undefined, paths: string[][]): number | null {
  const count = safeToken(value);
  if (count === null || count > 0) return count;
  return rawToken(usage, paths) === 0 ? 0 : null;
}
function baseToken(value: unknown, usage: LanguageModelUsage | null | undefined, paths: string[][]): number | null {
  const count = safeToken(value);
  if (count !== 0 || !usage?.raw) return count;
  return rawToken(usage, paths) === 0 ? 0 : null;
}
function tokens(usage?: LanguageModelUsage | null) {
  const inputTokens = baseToken(usage?.inputTokens, usage, [
    ['prompt_tokens'], ['input_tokens'], ['promptTokenCount'], ['toolUsePromptTokenCount'],
  ]);
  const outputTokens = baseToken(usage?.outputTokens, usage, [
    ['completion_tokens'], ['output_tokens'], ['candidatesTokenCount'], ['thoughtsTokenCount'],
  ]);
  const explicitTotal = rawToken(usage, [['total_tokens'], ['totalTokenCount']]);
  return {
    inputTokens, outputTokens,
    totalTokens: explicitTotal ?? (inputTokens !== null && outputTokens !== null
      ? safeToken(usage?.totalTokens) ?? safeToken(inputTokens + outputTokens) : null),
    reasoningTokens: detailToken(usage?.outputTokenDetails?.reasoningTokens, usage, [
      ['completion_tokens_details', 'reasoning_tokens'], ['output_tokens_details', 'reasoning_tokens'],
      ['output_tokens_details', 'thinking_tokens'], ['thoughtsTokenCount'],
    ]),
    cacheReadTokens: detailToken(usage?.inputTokenDetails?.cacheReadTokens, usage, [
      ['prompt_tokens_details', 'cached_tokens'], ['input_tokens_details', 'cached_tokens'],
      ['cache_read_input_tokens'], ['cachedContentTokenCount'],
    ]),
    cacheWriteTokens: detailToken(usage?.inputTokenDetails?.cacheWriteTokens, usage, [
      ['prompt_tokens_details', 'cache_write_tokens'], ['input_tokens_details', 'cache_write_tokens'],
      ['cache_creation_input_tokens'],
    ]),
  };
}

export function startModelUsage(entry: Model, provider: Provider, purpose: UsagePurpose) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let connectionName = '';
  try {
    connectionName = (sqlite().prepare('SELECT name FROM connections WHERE id=?').get(entry.connectionId) as { name?: string } | undefined)?.name ?? '';
  } catch (error) { console.error('Usage snapshot failed:', error instanceof Error ? error.name : 'UnknownError'); }
  let finished = false;
  let context: UsageContext | null = null;
  return {
    capture(value: UsageContext) { if (!finished) context = value; },
    setOutput(text: string, reasoning = '') { if (!finished && context) context.output = { text, reasoning }; },
    finish(status: UsageStatus, usage?: LanguageModelUsage | null, errorCode?: 'provider_error' | 'timeout' | 'invalid_output' | 'incomplete' | 'cancelled') {
      if (finished) return;
      finished = true;
      const count = tokens(usage);
      try {
        sqlite().prepare(`INSERT INTO usage_logs (
          id, started_at, duration_ms, model_record_id, model_name, connection_name, provider, model_id,
          purpose, status, reasoning_effort, error_code, input_tokens, output_tokens, total_tokens,
          reasoning_tokens, cache_read_tokens, cache_write_tokens, context_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          randomUUID(), startedAt, Math.max(0, Math.round(performance.now() - started)),
          entry.id, entry.name, connectionName, provider, entry.modelId, purpose, status,
          entry.reasoningEffort, errorCode ?? null, count.inputTokens, count.outputTokens, count.totalTokens,
          count.reasoningTokens, count.cacheReadTokens, count.cacheWriteTokens, context ? JSON.stringify(context) : null,
        );
      } catch (error) { console.error('Usage log failed:', error instanceof Error ? error.name : 'UnknownError'); }
    },
  };
}

function pageNumber(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null) return fallback;
  if (!/^\d{1,9}$/.test(value)) throw new ApiError(400, '分页参数无效');
  const number = Number(value);
  if (number < min || number > max) throw new ApiError(400, '分页参数超出范围');
  return number;
}

type UsageRow = Record<string, string | number | null>;
const recordColumns = `id,started_at,duration_ms,model_record_id,model_name,connection_name,provider,model_id,
  purpose,status,reasoning_effort,error_code,input_tokens,output_tokens,total_tokens,reasoning_tokens,cache_read_tokens,cache_write_tokens`;
function usageFromRow(row: UsageRow): UsageRecord {
  return {
    id: row.id as string, startedAt: row.started_at as string, durationMs: row.duration_ms as number,
    modelRecordId: row.model_record_id as string, modelName: row.model_name as string,
    connectionName: row.connection_name as string, provider: row.provider as Provider,
    modelId: row.model_id as string, purpose: row.purpose as UsagePurpose, status: row.status as UsageStatus,
    reasoningEffort: row.reasoning_effort as Model['reasoningEffort'], errorCode: row.error_code as string | null,
    inputTokens: row.input_tokens as number | null, outputTokens: row.output_tokens as number | null,
    totalTokens: row.total_tokens as number | null, reasoningTokens: row.reasoning_tokens as number | null,
    cacheReadTokens: row.cache_read_tokens as number | null, cacheWriteTokens: row.cache_write_tokens as number | null,
  };
}

export function usageDetail(id: string): UsageDetail {
  const row = sqlite().prepare(`SELECT ${recordColumns},context_json FROM usage_logs WHERE id=?`).get(id) as (UsageRow & { context_json: string | null }) | undefined;
  if (!row) throw new ApiError(404, '模型使用记录不存在');
  let context: UsageContext | null = null;
  if (row.context_json !== null) {
    try { context = JSON.parse(row.context_json) as UsageContext; }
    catch { /* A malformed old record remains viewable without its context. */ }
  }
  return { record: usageFromRow(row), context };
}

export function listUsage(search: URLSearchParams): UsageResult {
  const limit = pageNumber(search.get('limit'), 30, 1, 100);
  const offset = pageNumber(search.get('offset'), 0, 0, 1_000_000);
  const purpose = search.get('purpose');
  const status = search.get('status');
  const modelId = search.get('modelId');
  if (purpose && !['translate', 'explain', 'test'].includes(purpose)) throw new ApiError(400, '用途筛选无效');
  if (status && !['success', 'error', 'cancelled'].includes(status)) throw new ApiError(400, '状态筛选无效');
  if (modelId && (modelId.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(modelId))) throw new ApiError(400, '模型筛选无效');
  const filters: string[] = [];
  const params: string[] = [];
  if (purpose) { filters.push('purpose=?'); params.push(purpose); }
  if (status) { filters.push('status=?'); params.push(status); }
  if (modelId) { filters.push('model_record_id=?'); params.push(modelId); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const database = sqlite();
  const items = (database.prepare(`SELECT ${recordColumns} FROM usage_logs ${where} ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as UsageRow[]).map(usageFromRow);
  const summaryColumns = Object.values(tokenColumns).flatMap(column => [
    `COALESCE(SUM(${column}),0) AS ${column}_known_sum`,
    `COUNT(*)-COUNT(${column}) AS ${column}_unknown_count`,
  ]).join(',');
  const aggregate = database.prepare(`SELECT COUNT(*) AS calls,
    COALESCE(SUM(status='success'),0) AS success, COALESCE(SUM(status='error'),0) AS error,
    COALESCE(SUM(status='cancelled'),0) AS cancelled, ${summaryColumns}
    FROM usage_logs ${where}`).get(...params) as Record<string, number>;
  const tokenSummary = (field: TokenField): UsageTokenSummary => ({
    knownSum: aggregate[`${tokenColumns[field]}_known_sum`], unknownCount: aggregate[`${tokenColumns[field]}_unknown_count`],
  });
  const models = database.prepare(`SELECT model_record_id AS id, model_name AS name, model_id AS modelId
    FROM (SELECT model_record_id, model_name, model_id,
      ROW_NUMBER() OVER (PARTITION BY model_record_id ORDER BY started_at DESC, id DESC) AS row_number
      FROM usage_logs) WHERE row_number=1 ORDER BY name, modelId`).all() as UsageResult['models'];
  return {
    items, total: aggregate.calls, limit, offset, models,
    summary: {
      calls: aggregate.calls, success: aggregate.success, error: aggregate.error, cancelled: aggregate.cancelled,
      inputTokens: tokenSummary('inputTokens'), outputTokens: tokenSummary('outputTokens'),
      totalTokens: tokenSummary('totalTokens'), reasoningTokens: tokenSummary('reasoningTokens'),
      cacheReadTokens: tokenSummary('cacheReadTokens'), cacheWriteTokens: tokenSummary('cacheWriteTokens'),
    },
  };
}
