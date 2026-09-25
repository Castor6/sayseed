import React, { useEffect, useRef, useState } from 'react';
import { api, extensionConfig, normalizeBaseUrl, saveConnection } from './api';

interface ConnectionAppProps {
  embedded?: boolean;
  onConnected?: (connection: { baseUrl: string; token: string }) => void;
}

export function ConnectionApp({ embedded = false, onConnected }: ConnectionAppProps = {}) {
  const [baseUrl, setBaseUrl] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const connecting = useRef(false);

  useEffect(() => {
    let active = true;
    const refresh = () => { void extensionConfig().then(config => {
      if (!active) return;
      setBaseUrl(config.baseUrl); setToken(config.token); setReady(true);
    }).catch(() => { if (active) setMessage('无法读取扩展设置，请刷新页面重试'); }); };
    const changed = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && ('baseUrl' in changes || 'token' in changes)) refresh();
    };
    chrome.storage.onChanged.addListener(changed); refresh();
    return () => { active = false; chrome.storage.onChanged.removeListener(changed); };
  }, []);

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    if (connecting.current || !ready || !baseUrl || !password || token) return;
    connecting.current = true;
    setBusy(true); setMessage('正在登录…');
    try {
      const url = normalizeBaseUrl(baseUrl);
      await saveConnection(url);
      const result = await api<{ token: string }>('/api/auth/login', 'POST', { password });
      setBaseUrl(url); setToken(result.token); setPassword(''); setMessage('已连接，可以返回 X 使用助手。');
      onConnected?.({ baseUrl: url, token: result.token });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '连接失败，请重试');
    } finally {
      connecting.current = false; setBusy(false);
    }
  }

  const Container = embedded ? 'section' : 'main';
  return <Container>
    {!embedded && <>
    <p className="brand">Sayseed</p>
    <h1>连接你的 Sayseed</h1>
    <p>填写服务器地址与登录密码，连接你的 Sayseed 服务。</p>
    </>}
    <form onSubmit={connect}>
      <label htmlFor="base-url">服务地址</label>
      <input id="base-url" type="url" required value={baseUrl} disabled={!ready || busy} readOnly={!!token} onChange={event => setBaseUrl(event.target.value)} placeholder="http://localhost:3000" autoComplete="url" />
      {!token && <>
        <label htmlFor="password">登录密码</label>
        <input id="password" type="password" required value={password} disabled={!ready || busy} onChange={event => setPassword(event.target.value)} autoComplete="off" />
        <button type="submit" disabled={!ready || busy || !baseUrl || !password}>{busy ? '正在连接…' : '连接并登录'}</button>
      </>}
    </form>
    {token && !embedded && <>
      <p className="connected">● 已登录</p>
      <button onClick={() => chrome.tabs.create({ url: `${baseUrl}/settings` })}>打开模型与词库设置</button>
      <p>现在可以关闭此页。登录有效期为 30 天，使用时每天自动续期一次。</p>
    </>}
    {message && <p role="status">{message}</p>}
    {!embedded && <p className="hint">服务器权限用于连接你的 Sayseed 服务。普通网页划词需要在扩展菜单中另行开启。</p>}
  </Container>;
}
