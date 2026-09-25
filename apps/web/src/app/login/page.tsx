'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/components/api';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(true);

  useEffect(() => { api<{ authenticated: boolean; configured: boolean }>('/session').then(session => {
    if (session.authenticated) router.replace('/review');
    setConfigured(session.configured);
  }).catch(cause => setError(errorMessage(cause))); }, [router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password.trim()) return;
    setBusy(true); setError('');
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
      router.replace('/review');
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  return <div className="login-page"><div className="login-art"><span className="brand-mark large">s<span>·</span></span><div className="login-art-copy"><span className="eyebrow">YOUR WORDS, GROWING</span><h1>把想法说出去，<br />把表达留下来。</h1><p>每一次真实交流，都可以成为下一次表达的种子。</p></div><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/></div><main className="login-panel"><div className="login-form-wrap"><div className="mobile-brand">Sayseed<span>·</span></div><span className="eyebrow">WELCOME BACK</span><h2>继续你的表达之旅</h2><p className="muted">登录后查看词库与今日复习。</p>{!configured && <div className="notice error">服务端尚未配置登录密码。请设置 SAYSEED_PASSWORD 后重启服务。</div>}<form onSubmit={submit}><label htmlFor="password">登录密码</label><input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" placeholder="输入你的密码" disabled={!configured || busy} /><button className="button primary full" disabled={!configured || busy || !password.trim()}>{busy ? '正在登录…' : '登录 Sayseed'}<span aria-hidden="true">↗</span></button></form>{error && <p className="form-error" role="alert">{error}</p>}<p className="login-footnote">Sayseed 是你的私人学习空间，没有公开注册。</p></div></main></div>;
}
