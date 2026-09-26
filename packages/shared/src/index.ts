import { z } from 'zod';

export const providerSchema = z.enum(['openai', 'anthropic', 'google', 'openai-compatible']);
export type Provider = z.infer<typeof providerSchema>;
export interface Connection { id: string; name: string; provider: Provider; baseUrl: string; hasApiKey: boolean }
const tokenLimitSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const reasoningEffortSchema = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export const modelCapabilitiesSchema = z.object({
  supportsImages: z.boolean().optional(), contextWindow: tokenLimitSchema.optional(),
  maxInputTokens: tokenLimitSchema.optional(), maxOutputTokens: tokenLimitSchema.optional(),
  reasoningEffortLevels: z.array(reasoningEffortSchema).max(7).optional(),
  defaultReasoningEffort: reasoningEffortSchema.optional(),
});
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;
export interface Model { id: string; connectionId: string; name: string; modelId: string; supportsImages: boolean; isDefault: boolean; reasoningEffort: ReasoningEffort | null; capabilities?: ModelCapabilities }
export interface DiscoveredModel { id: string; name: string; description?: string; capabilities?: ModelCapabilities }
export interface DiscoveredModelsResult { models: DiscoveredModel[]; truncated: boolean }

export const promptKindSchema = z.enum(['translate', 'explain']);
export type PromptKind = z.infer<typeof promptKindSchema>;
export const PROMPT_BODY_LIMIT = 20000;
const promptBodySchema = z.string().max(PROMPT_BODY_LIMIT).refine(value => value.trim().length > 0, '提示词正文不能为空');
export const promptDraftSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('default') }).strict(),
  z.object({ mode: z.literal('custom'), body: promptBodySchema }).strict(),
]);
export type PromptDraft = z.infer<typeof promptDraftSchema>;
const promptSaveVersion = {
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  defaultVersion: z.string().min(1).max(100), protocolVersion: z.string().min(1).max(100),
};
export const promptSaveSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('default'), ...promptSaveVersion }).strict(),
  z.object({ mode: z.literal('custom'), body: promptBodySchema, ...promptSaveVersion }).strict(),
]);
export type PromptSaveInput = z.infer<typeof promptSaveSchema>;
export interface PromptVersionInfo {
  kind: PromptKind; mode: 'default' | 'custom'; revision: number;
  defaultVersion: string; protocolVersion: string;
}
export interface PromptRevision extends PromptVersionInfo { body: string; updatedAt: string | null }
export interface PromptSetting extends PromptRevision { defaultBody: string; fixedRules: string; system: string }
export interface PromptSettingsResult { prompts: PromptSetting[] }
export interface PromptHistoryResult { items: PromptRevision[]; total: number; limit: number; offset: number }

export type UsagePurpose = 'translate' | 'explain' | 'test';
export type UsageStatus = 'success' | 'error' | 'cancelled';
export interface UsageRecord {
  id: string; startedAt: string; durationMs: number;
  modelRecordId: string; modelName: string; connectionName: string;
  provider: Provider; modelId: string; purpose: UsagePurpose; status: UsageStatus;
  reasoningEffort: ReasoningEffort | null; errorCode: string | null;
  inputTokens: number | null; outputTokens: number | null; totalTokens: number | null;
  reasoningTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null;
}
export interface UsageTokenSummary { knownSum: number; unknownCount: number }
export interface UsageSummary {
  calls: number; success: number; error: number; cancelled: number;
  inputTokens: UsageTokenSummary; outputTokens: UsageTokenSummary; totalTokens: UsageTokenSummary;
  reasoningTokens: UsageTokenSummary; cacheReadTokens: UsageTokenSummary; cacheWriteTokens: UsageTokenSummary;
}
export interface UsageResult {
  items: UsageRecord[]; total: number; limit: number; offset: number; summary: UsageSummary;
  models: Array<{ id: string; name: string; modelId: string }>;
}
export type UsageContentPart = { type: 'text'; text: string } | {
  type: 'image'; mediaType: string; data: string; source?: string;
};
export interface UsageContext {
  system: string | null;
  prompt?: PromptVersionInfo;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: UsageContentPart[] }>;
  options: Record<string, unknown>;
  output: { text: string; reasoning: string } | null;
}
export interface UsageDetail { record: UsageRecord; context: UsageContext | null }

export const contextPostSchema = z.object({
  id: z.string().optional(), author: z.string().max(200).optional(),
  text: z.string().max(20000), url: z.string().max(2048).optional(),
  images: z.array(z.string().max(8000000)).max(4).default([]),
});
export type ContextPost = z.infer<typeof contextPostSchema>;
export const contextSchema = z.object({
  mode: z.enum(['post', 'reply', 'quote']), target: contextPostSchema.optional(),
  ancestors: z.array(contextPostSchema).max(8).default([]), quoted: contextPostSchema.optional(),
  supplement: z.string().max(12000).default(''), incompleteReasons: z.array(z.string()).default([]),
});
export type TranslationContext = z.infer<typeof contextSchema>;
export const translateSchema = z.object({
  draft: z.string().trim().min(1).max(20000), context: contextSchema,
  modelId: z.string().optional(), instruction: z.string().max(4000).optional(),
  previousTranslation: z.string().max(30000).optional(),
});
export type TranslateInput = z.infer<typeof translateSchema>;
export type TranslationEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; text: string; kind: 'translation' | 'clarification' }
  | { type: 'error'; message: string };

export const explainSchema = z.object({
  selection: z.string().trim().min(1).max(2000), sentence: z.string().trim().min(1).max(12000),
  context: z.string().max(16000).optional(), modelId: z.string().optional(),
});
export type ExplainInput = z.infer<typeof explainSchema>;
export const explanationSchema = z.object({
  meaning: z.string().min(1), sentenceTranslation: z.string().min(1), usage: z.string(),
});
export type Explanation = z.infer<typeof explanationSchema>;

export const noteInputSchema = z.object({
  expression: z.string().trim().min(1).max(2000), sentence: z.string().trim().min(1).max(12000),
  meaning: z.string().trim().min(1).max(12000), sentenceTranslation: z.string().max(16000).default(''),
  usage: z.string().max(12000).default(''), context: z.string().max(20000).default(''),
  sourceKind: z.enum(['translation', 'webpage']), sourceUrl: z.string().max(2048).default(''),
  sourceTitle: z.string().max(500).default(''), draftZh: z.string().max(20000).default(''),
});
export type NoteInput = z.infer<typeof noteInputSchema>;
export interface Note extends NoteInput { id: string; suspended: boolean; createdAt: string; updatedAt: string }
export interface ReviewItem { note: Note; cardId: string; revision: number; due: string; state: number; intervals: Record<'1' | '2' | '3' | '4', string> }
export const reviewInputSchema = z.object({
  cardId: z.string().min(1), revision: z.number().int().min(0), rating: z.number().int().min(1).max(4),
  idempotencyKey: z.string().min(8).max(100),
});
const endpointSchema = z.string().trim().max(2048).refine(value => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}, '请输入有效的 HTTP 或 HTTPS 接口地址');
export const connectionInputSchema = z.object({ name: z.string().trim().min(1).max(100), provider: providerSchema, baseUrl: endpointSchema.default(''), apiKey: z.string().max(4000).optional() });
export const modelInputSchema = z.object({ connectionId: z.string().min(1), name: z.string().trim().min(1).max(100), modelId: z.string().trim().min(1).max(200), supportsImages: z.boolean().optional(), isDefault: z.boolean().default(false), capabilities: modelCapabilitiesSchema.optional(), reasoningEffort: reasoningEffortSchema.nullable().optional() });
// Zod defaults must not turn omitted PATCH fields into configuration changes.
export const connectionPatchSchema = connectionInputSchema.partial().extend({ baseUrl: endpointSchema.optional() });
export const modelPatchSchema = modelInputSchema.partial().extend({ isDefault: z.boolean().optional() });

export const REVIEW_LABELS = { 1: '没想起来', 2: '费劲想起来', 3: '正常想起来', 4: '轻松想起来' } as const;

export function emptyContext(): TranslationContext {
  return { mode: 'post', ancestors: [], supplement: '', incompleteReasons: [] };
}

export function safeSourceUrl(value: string): string {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
