// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: vi.fn(),
  extensionConfig: vi.fn(),
  saveConnection: vi.fn(),
  normalizeBaseUrl: (value: string) => value.replace(/\/$/, ''),
}));
import { api, extensionConfig, saveConnection } from './api';
import { ConnectionApp } from './connection-ui';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let root: Root;
let holder: HTMLElement;
let requestPermission: ReturnType<typeof vi.fn>;
let store: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(api).mockReset();
  vi.mocked(extensionConfig).mockReset().mockResolvedValue({ baseUrl: '', token: '', webpageSelection: false });
  vi.mocked(saveConnection).mockReset().mockResolvedValue(undefined);
  requestPermission = vi.fn();
  store = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    permissions: { request: requestPermission },
    storage: { local: { set: store }, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    tabs: { create: vi.fn() },
  });
  holder = document.createElement('div');
  document.body.append(holder);
  root = createRoot(holder);
  await act(async () => root.render(<ConnectionApp />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  holder.remove();
  vi.unstubAllGlobals();
});

async function fill(inputId: string, value: string) {
  const input = holder.querySelector<HTMLInputElement>(`#${inputId}`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    holder.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

async function enterCredentials() {
  await fill('base-url', 'http://localhost:3000/');
  await fill('password', 'test-password');
}

it('logs in without a runtime permission prompt and never stores the password in the UI', async () => {
  vi.mocked(api).mockResolvedValue({ token: 'session-token' });
  await enterCredentials();
  await submit();

  expect(requestPermission).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledOnce();
  expect(api).toHaveBeenCalledWith('/api/auth/login', 'POST', { password: 'test-password' });
  expect(saveConnection).toHaveBeenCalledExactlyOnceWith('http://localhost:3000');
  expect(store).not.toHaveBeenCalled();
  expect(holder.textContent).toContain('已登录');
  expect(holder.querySelector('#password')).toBeNull();
});

it('does not log in after connection settings fail to save and allows another submission', async () => {
  vi.mocked(saveConnection).mockRejectedValueOnce(new Error('无法保存连接设置')).mockResolvedValueOnce(undefined);
  vi.mocked(api).mockResolvedValue({ token: 'retry-token' });
  await enterCredentials();
  await submit();
  expect(api).not.toHaveBeenCalled();
  expect(store).not.toHaveBeenCalled();
  expect(holder.textContent).toContain('无法保存连接设置');
  expect(holder.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);

  await submit();
  expect(requestPermission).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledOnce();
  expect(holder.textContent).toContain('已登录');
});

it('keeps the form available after a login failure and succeeds on retry', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('密码错误')).mockResolvedValueOnce({ token: 'new-token' });
  await enterCredentials();
  await submit();
  expect(holder.textContent).toContain('密码错误');
  expect(holder.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  expect(saveConnection).toHaveBeenCalledExactlyOnceWith('http://localhost:3000');

  await submit();
  expect(requestPermission).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledTimes(2);
  expect(store).not.toHaveBeenCalled();
  expect(holder.textContent).toContain('已登录');
});

it('does not send duplicate login requests while connecting', async () => {
  const login = deferred<{ token: string }>();
  vi.mocked(api).mockReturnValue(login.promise);
  await enterCredentials();
  await submit();
  expect(holder.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await submit();
  expect(api).toHaveBeenCalledOnce();
  expect(requestPermission).not.toHaveBeenCalled();

  await act(async () => login.resolve({ token: 'session-token' }));
  expect(holder.textContent).toContain('已登录');
});
