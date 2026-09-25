import type { ContextPost, ExplainInput, Explanation, Model, NoteInput, TranslateInput, TranslationContext, TranslationEvent } from '@sayseed/shared';
import { activeSession } from './session';

export type ApiRequest =
  | { type: 'api'; path: string; method?: 'GET' | 'POST'; body?: unknown }
  | { type: 'config' }
  | { type: 'setConfig'; baseUrl: string; token: string };
export type ApiResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export function normalizeBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('请输入有效的 http(s) 服务地址');
  }
  return url.href.replace(/\/$/, '');
}

export async function api<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage({ type: 'api', path, method, body } satisfies ApiRequest) as ApiResponse<T>;
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

export async function models(): Promise<Model[]> {
  return (await api<{ models: Model[] }>('/api/models')).models;
}

export async function explain(input: ExplainInput): Promise<Explanation> {
  return (await api<{ explanation: Explanation }>('/api/explain', 'POST', input)).explanation;
}

export async function saveNote(input: NoteInput): Promise<{ duplicate: boolean }> {
  return await api<{ duplicate: boolean }>('/api/notes', 'POST', input);
}

export interface TranslationStream {
  cancel(): void;
}

function textOnlyContext(context: TranslationContext): TranslationContext {
  const textOnlyPost = (post: ContextPost): ContextPost => ({ ...post, images: [] });
  return {
    ...context,
    ...(context.target ? { target: textOnlyPost(context.target) } : {}),
    ancestors: context.ancestors.map(textOnlyPost),
    ...(context.quoted ? { quoted: textOnlyPost(context.quoted) } : {}),
  };
}

export function translate(input: TranslateInput, onEvent: (event: TranslationEvent) => void): TranslationStream {
  const port = chrome.runtime.connect({ name: 'sayseed-translate' });
  let stopped = false;
  let finished = false;
  port.onMessage.addListener((message: TranslationEvent) => {
    if (stopped) return;
    if (message.type === 'done' || message.type === 'error') finished = true;
    onEvent(message);
    if (finished) port.disconnect();
  });
  port.onDisconnect.addListener(() => {
    if (!stopped && !finished) onEvent({ type: 'error', message: '与翻译服务的连接已中断' });
  });
  port.postMessage({ type: 'translate', input: { ...input, context: textOnlyContext(input.context) } });
  return { cancel: () => { stopped = true; port.disconnect(); } };
}

export async function extensionConfig(): Promise<{ baseUrl: string; token: string; webpageSelection: boolean }> {
  const config = await chrome.storage.local.get({ baseUrl: '', token: '', webpageSelection: false }) as { baseUrl: string; token: string; webpageSelection: boolean };
  return { ...config, token: activeSession(config.token) ? config.token : '' };
}

export async function saveConnection(baseUrl: string, token = ''): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'setConfig', baseUrl, token } satisfies ApiRequest) as ApiResponse;
  if (!response.ok) throw new Error(response.error);
}
