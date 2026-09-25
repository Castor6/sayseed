import type { ApiRequest } from '../src/api';
import { requestServer as request, setConnection } from '../src/server-request';
import { createSseParser } from '../src/stream';
import type { TranslationEvent } from '@sayseed/shared';

export default defineBackground(() => {
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  chrome.runtime.onMessage.addListener((message: ApiRequest, sender, respond) => {
    if (message.type === 'setConfig') {
      if (!sender.url?.startsWith(chrome.runtime.getURL('/'))) { respond({ ok: false, error: '不支持的设置来源' }); return; }
      void setConnection(message.baseUrl, message.token).then(() => respond({ ok: true, data: null }),
        error => respond({ ok: false, error: error instanceof Error ? error.message : '无法保存连接设置' }));
      return true;
    }
    if (message.type !== 'api') return;
    void (async () => {
      try {
        const result = await request(message.path, message.method, message.body);
        const data = await result.json() as { error?: string };
        respond(result.ok ? { ok: true, data } : { ok: false, error: data.error || `请求失败 (${result.status})` });
      } catch (error) { respond({ ok: false, error: error instanceof Error ? error.message : '网络请求失败' }); }
    })();
    return true;
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'sayseed-translate') return;
    const controller = new AbortController();
    port.onDisconnect.addListener(() => controller.abort());
    port.onMessage.addListener((message: { type: string; input: unknown }) => {
      if (message.type !== 'translate') return;
      void (async () => {
        let completed = false;
        try {
          const response = await request('/api/translate', 'POST', message.input, controller.signal);
          if (!response.ok || !response.body) {
            const data = await response.json().catch(() => ({})) as { error?: string };
            throw new Error(data.error || `翻译失败 (${response.status})`);
          }
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          const parse = createSseParser((event: TranslationEvent) => {
            if (event.type === 'done' || event.type === 'error') completed = true;
            try { port.postMessage(event); } catch { controller.abort(); }
          });
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parse(decoder.decode(value, { stream: true }));
          }
          parse(decoder.decode() + '\n\n');
          if (!completed && !controller.signal.aborted) port.postMessage({ type: 'error', message: '翻译流意外中断' });
        } catch (error) {
          if (!controller.signal.aborted) try { port.postMessage({ type: 'error', message: error instanceof Error ? error.message : '翻译失败' }); } catch { /* The view was closed. */ }
        }
      })();
    });
  });
});
