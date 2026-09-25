import { normalizeBaseUrl } from './api';
import { activeSession, sessionDetails, withSessionStorage } from './session';

export async function setConnection(baseUrl: string, token: string): Promise<void> {
  const url = normalizeBaseUrl(baseUrl);
  await withSessionStorage(() => chrome.storage.local.set({ baseUrl: url, token }));
}

export async function requestServer(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<Response> {
  if (!/^\/api\/(auth\/login|models|translate|explain|notes)(?:\?.*)?$/.test(path)) throw new Error('不支持的请求地址');
  const { baseUrl, token: storedToken } = await chrome.storage.local.get(['baseUrl', 'token']);
  const token = typeof storedToken === 'string' ? storedToken : '';
  if (!baseUrl) throw new Error('请先在扩展设置中连接服务');
  const login = path === '/api/auth/login';
  const clearCurrent = () => withSessionStorage(async () => {
    const current = await chrome.storage.local.get(['baseUrl', 'token']);
    if (current.baseUrl === baseUrl && current.token === token) await chrome.storage.local.set({ token: '' });
  });
  if (!login && !activeSession(token)) {
    if (token) await clearCurrent();
    throw new Error(token ? '登录已过期，请重新登录 Sayseed' : '请先登录 Sayseed');
  }
  const base = new URL(normalizeBaseUrl(String(baseUrl)));
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new Error('不支持的服务地址');
  const response = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(!login ? { Authorization: `Bearer ${token}`, 'X-Sayseed-Activity': '1' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'omit', signal,
  });
  if (login && response.ok) {
    const data = await response.clone().json() as { token?: string };
    if (!data.token || !activeSession(data.token)) throw new Error('服务器返回了无效的登录状态');
    await withSessionStorage(async () => {
      const current = await chrome.storage.local.get(['baseUrl', 'token']);
      if (current.baseUrl !== baseUrl || (current.token || '') !== token) throw new Error('连接设置已改变，请重新登录');
      await chrome.storage.local.set({ token: data.token });
    });
  } else if (!login && response.status === 401) {
    await clearCurrent();
  } else if (!login && response.ok) {
    const renewed = response.headers.get('X-Sayseed-Session');
    const next = renewed && sessionDetails(renewed);
    const original = sessionDetails(token);
    if (renewed && next && original && next.nonce === original.nonce && next.exp > Date.now()) {
      await withSessionStorage(async () => {
        const current = await chrome.storage.local.get(['baseUrl', 'token']);
        const existing = sessionDetails(typeof current.token === 'string' ? current.token : '');
        if (current.baseUrl === baseUrl && existing?.nonce === original.nonce && next.exp > existing.exp) {
          await chrome.storage.local.set({ token: renewed });
        }
      });
    }
  }
  return response;
}
