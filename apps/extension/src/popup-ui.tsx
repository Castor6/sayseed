import React, { useEffect, useState } from 'react';
import { extensionConfig, saveConnection } from './api';
import { ConnectionApp } from './connection-ui';

async function syncSelection(enabled: boolean) {
  const id = 'sayseed-web-selection';
  const current = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (current.length) await chrome.scripting.unregisterContentScripts({ ids: [id] });
  if (enabled) {
    await chrome.scripting.registerContentScripts([{ id, matches: ['http://*/*', 'https://*/*'], js: ['selection.js'], runAt: 'document_idle', persistAcrossSessions: true }]);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && tab.url && /^https?:/.test(tab.url)) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['selection.js'] }).catch(() => {});
  }
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter(tab => tab.id).map(tab => chrome.tabs.sendMessage(tab.id!, { type: enabled ? 'sayseed-selection-enable' : 'sayseed-selection-disable' }).catch(() => {})));
}

export function PopupApp() {
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [webpageSelection, setWebpageSelection] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => { void extensionConfig().then(config => {
      if (!active) return;
      setBaseUrl(config.baseUrl); setToken(config.token); setWebpageSelection(config.webpageSelection); setReady(true);
    }).catch(() => { if (active) setMessage('无法读取扩展设置，请重新打开扩展'); }); };
    const changed = (_changes: unknown, area: string) => { if (area === 'local') refresh(); };
    chrome.storage.onChanged.addListener(changed); refresh();
    return () => { active = false; chrome.storage.onChanged.removeListener(changed); };
  }, []);
  async function toggle() {
    setBusy(true); setMessage('');
    try {
      const next = !webpageSelection;
      await syncSelection(next);
      await chrome.storage.local.set({ webpageSelection: next });
      setWebpageSelection(next);
      setMessage(next ? '网页划词已开启' : '网页划词已关闭');
    } catch (e) { setMessage(e instanceof Error ? e.message : '设置失败'); }
    finally { setBusy(false); }
  }
  async function logout() {
    try { await saveConnection(baseUrl); setToken(''); setMessage('已退出'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '退出失败，请重试'); }
  }
  return <main>
    <h1>Sayseed</h1><p>在 X 用自然英文表达，顺手学会新表达。</p>
    {token && <p className="server">{baseUrl}</p>}
    {!ready ? <p role="status">正在读取连接设置…</p> : token ? <>
      <div className="row"><span>● 已登录</span><button onClick={logout}>退出</button></div>
      <p className="hint">登录有效期为 30 天，使用时每天自动续期一次。</p>
    </> : <ConnectionApp embedded onConnected={connection => { setBaseUrl(connection.baseUrl); setToken(connection.token); setMessage(''); }} />}
    <hr /><div className="row"><strong>普通网页划词解释</strong><button disabled={!ready || busy} onClick={toggle}>{webpageSelection ? '关闭' : '开启'}</button></div>
    <p className="hint">选中英文后点击「解释」才会调用模型。可随时关闭划词功能。</p>
    {token && <button onClick={() => chrome.tabs.create({ url: `${baseUrl}/settings` })}>打开模型与词库设置</button>}
    {message && <p role="status">{message}</p>}
  </main>;
}
