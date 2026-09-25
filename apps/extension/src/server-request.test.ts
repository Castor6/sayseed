import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { extensionConfig } from './api';
import { requestServer, setConnection } from './server-request';
import { sessionDetails, withSessionStorage } from './session';

let data: Record<string, unknown>;
const now = 1_800_000_000_000;
function token(exp = now + 86400000, nonce = 'session-a') {
  return `${btoa(JSON.stringify({ exp, nonce })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.signature`;
}
function response(renewed?: string, status = 200) {
  return Response.json(status === 401 ? { error: '请先登录' } : { ok: true }, { status, headers: renewed ? { 'X-Sayseed-Session': renewed } : {} });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  data = { baseUrl: 'http://localhost:3000', token: token(), webpageSelection: false };
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async (keys: string[] | Record<string, unknown>) => Array.isArray(keys) ? { ...data } : { ...keys, ...data }),
    set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, values); }),
  } } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
});
afterEach(async () => { await withSessionStorage(async () => {}); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('stores renewed bearer credentials and marks user requests as activity', async () => {
  const renewed = token(now + 30 * 86400000);
  vi.mocked(fetch).mockResolvedValue(response(renewed));
  await requestServer('/api/models');
  expect(data.token).toBe(renewed);
  expect(vi.mocked(fetch).mock.calls[0]![1]).toMatchObject({ credentials: 'omit', headers: { Authorization: `Bearer ${token()}`, 'X-Sayseed-Activity': '1' } });
});

it('ignores older renewal responses and keeps the newest expiry under concurrent requests', async () => {
  const first = deferred<Response>(), second = deferred<Response>();
  vi.mocked(fetch).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const a = requestServer('/api/models'), b = requestServer('/api/models');
  second.resolve(response(token(now + 30 * 86400000)));
  await b;
  first.resolve(response(token(now + 29 * 86400000)));
  await a;
  expect(sessionDetails(String(data.token))?.exp).toBe(now + 30 * 86400000);
});

it('a late renewal cannot undo logout or overwrite a different login or server', async () => {
  for (const next of [
    { baseUrl: 'http://localhost:3000', token: '' },
    { baseUrl: 'http://localhost:3000', token: token(now + 86400000, 'new-login') },
    { baseUrl: 'http://localhost:4000', token: token() },
  ]) {
    data = { baseUrl: 'http://localhost:3000', token: token() };
    const pending = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    const request = requestServer('/api/models');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await setConnection(next.baseUrl, next.token);
    pending.resolve(response(token(now + 30 * 86400000)));
    await request;
    expect(data).toMatchObject(next);
    vi.mocked(fetch).mockClear();
  }
});

it('401 clears the failed token but does not erase a concurrently renewed session', async () => {
  const failed = deferred<Response>();
  vi.mocked(fetch).mockReturnValueOnce(failed.promise);
  const request = requestServer('/api/models');
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const renewed = token(now + 30 * 86400000);
  await setConnection('http://localhost:3000', renewed);
  failed.resolve(response(undefined, 401));
  await request;
  expect(data.token).toBe(renewed);
  vi.mocked(fetch).mockResolvedValue(response(undefined, 401));
  await requestServer('/api/models');
  expect(data.token).toBe('');
});

it('expired stored sessions appear logged out and cannot make requests or refresh themselves', async () => {
  data.token = token(now);
  expect((await extensionConfig()).token).toBe('');
  await expect(requestServer('/api/models')).rejects.toThrow('登录已过期');
  expect(data.token).toBe('');
  expect(fetch).not.toHaveBeenCalled();
});

it('login is persisted by the background without saving its password', async () => {
  data.token = '';
  vi.mocked(fetch).mockResolvedValue(Response.json({ token: token() }));
  const response = await requestServer('/api/auth/login', 'POST', { password: 'fixture-only-password' });
  expect(await response.json()).toEqual({ token: token() });
  expect(data.token).toBe(token());
  expect(JSON.stringify(data)).not.toContain('fixture-only-password');
  expect(vi.mocked(fetch).mock.calls[0]![1]?.headers).not.toHaveProperty('Authorization');
});

it('a login response cannot overwrite a connection changed while waiting', async () => {
  data.token = '';
  const pending = deferred<Response>();
  vi.mocked(fetch).mockReturnValue(pending.promise);
  const login = requestServer('/api/auth/login', 'POST', { password: 'fixture' });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await setConnection('http://localhost:4000', '');
  pending.resolve(Response.json({ token: token() }));
  await expect(login).rejects.toThrow('连接设置已改变');
  expect(data).toMatchObject({ baseUrl: 'http://localhost:4000', token: '' });
});

it('rejects foreign or malformed renewal tokens without replacing the current session', async () => {
  for (const renewed of ['invalid', token(now + 30 * 86400000, 'other-session'), token(now - 1)]) {
    vi.mocked(fetch).mockResolvedValue(response(renewed));
    await requestServer('/api/models');
    expect(data.token).toBe(token());
  }
});
