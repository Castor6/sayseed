// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: vi.fn(), extensionConfig: vi.fn(), saveConnection: vi.fn(),
  normalizeBaseUrl: (value: string) => value.replace(/\/$/, ''),
}));
import { api, extensionConfig, saveConnection } from './api';
import { PopupApp } from './popup-ui';

let root: Root;
let holder: HTMLElement;
let config: { baseUrl: string; token: string; webpageSelection: boolean };
let createTab: ReturnType<typeof vi.fn>;
let permission: ReturnType<typeof vi.fn>;
let storageListeners: Set<(changes: Record<string, unknown>, area: string) => void>;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  config = { baseUrl: 'http://localhost:3000', token: '', webpageSelection: false };
  vi.mocked(extensionConfig).mockReset().mockImplementation(async () => ({ ...config }));
  vi.mocked(saveConnection).mockReset().mockImplementation(async baseUrl => { config = { ...config, baseUrl, token: '' }; });
  vi.mocked(api).mockReset();
  createTab = vi.fn(); permission = vi.fn();
  storageListeners = new Set();
  vi.stubGlobal('chrome', {
    tabs: { create: createTab }, permissions: { request: permission },
    storage: { onChanged: {
      addListener: (listener: (changes: Record<string, unknown>, area: string) => void) => storageListeners.add(listener),
      removeListener: (listener: (changes: Record<string, unknown>, area: string) => void) => storageListeners.delete(listener),
    } },
  });
  holder = document.createElement('div'); document.body.append(holder);
  root = createRoot(holder);
  await act(async () => root.render(<PopupApp />));
});

afterEach(async () => {
  await act(async () => root.unmount()); holder.remove(); vi.unstubAllGlobals();
});

async function submit(password = 'fixture-password') {
  await act(async () => {
    const field = holder.querySelector<HTMLInputElement>('#password')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, password);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { holder.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}

async function reopen() {
  await act(async () => root.unmount()); root = createRoot(holder);
  await act(async () => root.render(<PopupApp />));
}

it('logs in within the popup and restores the stored session after reopening without opening a tab', async () => {
  vi.mocked(api).mockImplementation(async () => { config.token = 'fixture-session'; return { token: config.token }; });
  expect(holder.querySelector<HTMLInputElement>('#base-url')!.value).toBe(config.baseUrl);
  await submit();
  expect(api).toHaveBeenCalledExactlyOnceWith('/api/auth/login', 'POST', { password: 'fixture-password' });
  expect(holder.textContent).toContain('已登录');
  expect(holder.querySelector('#password')).toBeNull();
  await reopen();
  expect(holder.textContent).toContain('已登录');
  expect(holder.querySelector('form')).toBeNull();
  expect(createTab).not.toHaveBeenCalled(); expect(permission).not.toHaveBeenCalled();

  const logout = [...holder.querySelectorAll('button')].find(button => button.textContent === '退出')!;
  await act(async () => logout.click());
  expect(holder.querySelector('#password')).not.toBeNull();
  expect(holder.querySelector<HTMLInputElement>('#base-url')!.value).toBe('http://localhost:3000');
  expect(createTab).not.toHaveBeenCalled();
});

it('keeps login errors and retry inside the popup', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('密码错误')).mockResolvedValueOnce({ token: 'fixture-session' });
  await submit(); expect(holder.textContent).toContain('密码错误');
  await submit('correct-password'); expect(holder.textContent).toContain('已登录');
  expect(api).toHaveBeenCalledTimes(2);
  expect(createTab).not.toHaveBeenCalled(); expect(permission).not.toHaveBeenCalled();
});

it('does not replace an unsaved server address when the selection setting changes', async () => {
  await act(async () => {
    const field = holder.querySelector<HTMLInputElement>('#base-url')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'https://new-server.example');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    config.webpageSelection = true;
    for (const listener of storageListeners) listener({ webpageSelection: { oldValue: false, newValue: true } }, 'local');
  });
  expect(holder.querySelector<HTMLInputElement>('#base-url')!.value).toBe('https://new-server.example');
  vi.mocked(api).mockResolvedValue({ token: 'new-server-session' });
  await submit();
  expect(saveConnection).toHaveBeenCalledExactlyOnceWith('https://new-server.example');
});

it('reads the session persisted by the background when the popup closed during login', async () => {
  let resolve!: (value: { token: string }) => void;
  vi.mocked(api).mockReturnValue(new Promise(yes => { resolve = yes; }));
  await submit();
  await act(async () => root.unmount());
  config.token = 'background-session';
  await act(async () => resolve({ token: config.token }));
  root = createRoot(holder);
  await act(async () => root.render(<PopupApp />));
  expect(holder.textContent).toContain('已登录');
  expect(holder.querySelector('#password')).toBeNull();
  expect(createTab).not.toHaveBeenCalled();
});
