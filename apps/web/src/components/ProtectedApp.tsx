'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorMessage } from './api';

type Session = { authenticated: boolean; configured: boolean };

export function ProtectedApp({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api<Session>('/session').then(value => {
      if (!active) return;
      setSession(value);
      if (!value.authenticated) router.replace('/login');
    }).catch(cause => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [router]);

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
      router.replace('/login');
    } catch (cause) { setError(errorMessage(cause)); }
  }

  if (error) return <div className="center-state"><div className="state-mark">!</div><h1>暂时无法连接</h1><p>{error}</p><button onClick={() => location.reload()} className="button primary">重试</button></div>;
  if (!session?.authenticated) return <div className="center-state"><div className="loader" aria-label="正在加载" /><p>正在连接 Sayseed…</p></div>;

  const links = [
    { href: '/review', label: '今日复习', icon: '◫' },
    { href: '/notes', label: '词库', icon: '▤' },
    { href: '/usage', label: '模型使用记录', icon: '◷' },
    { href: '/settings', label: '设置', icon: '⚙' },
  ];

  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/review" className="brand"><span className="brand-mark">s<span>·</span></span><span>Sayseed<small>让表达生根</small></span></Link>
      <nav className="side-nav" aria-label="主导航">{links.map(link => <Link key={link.href} href={link.href} className={pathname === link.href ? 'nav-link active' : 'nav-link'}><span aria-hidden="true">{link.icon}</span>{link.label}</Link>)}</nav>
      <div className="sidebar-bottom"><span className="sidebar-caption">在真实语境中积累表达</span><button onClick={logout} className="text-button">退出登录</button></div>
    </aside>
    <main className="main-content">{children}{pathname === '/settings' && <div className="mobile-signout"><button onClick={logout} className="text-button">退出登录</button></div>}</main>
    <nav className="bottom-nav" aria-label="主导航">{links.map(link => <Link key={link.href} href={link.href} className={pathname === link.href ? 'bottom-link active' : 'bottom-link'}><span aria-hidden="true">{link.icon}</span><span>{link.label}</span></Link>)}</nav>
  </div>;
}
