'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewItem } from '@sayseed/shared';
import { REVIEW_LABELS } from '@sayseed/shared';
import { ProtectedApp } from '@/components/ProtectedApp';
import { HighlightedSentence } from '@/components/HighlightedSentence';
import { ApiError, api, errorMessage } from '@/components/api';

type ReviewResponse = { items: ReviewItem[]; dueCount: number; newCount: number };
type Pending = { cardId: string; revision: number; rating: number; idempotencyKey: string };

function nextTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '稍后';
  const minutes = Math.round((date.getTime() - Date.now()) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟后`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时后`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天后`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months} 个月后` : `${Math.round(months / 12)} 年后`;
}

function ReviewContent() {
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [awaitingRefresh, setAwaitingRefresh] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const activeCard = useRef('');
  const submitLock = useRef(false);

  const load = useCallback(async (retainCurrent = false) => {
    if (!retainCurrent) setLoading(true);
    try {
      const next = await api<ReviewResponse>('/review');
      setData(next);
      setAwaitingRefresh(false);
      setError('');
      const identity = next.items[0] ? `${next.items[0].cardId}:${next.items[0].revision}` : '';
      if (identity !== activeCard.current) { setRevealed(false); activeCard.current = identity; }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const item = data?.items[0];
  async function rate(rating: number) {
    if (!item || submitLock.current || awaitingRefresh || !revealed) return;
    submitLock.current = true;
    const request = pending ?? { cardId: item.cardId, revision: item.revision, rating, idempotencyKey: crypto.randomUUID() };
    setPending(request); setSubmitting(true); setError('');
    try {
      await api('/review', { method: 'POST', body: JSON.stringify(request) });
      setPending(null);
      setAwaitingRefresh(true);
      await load(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setPending(null);
        setAwaitingRefresh(true);
        setError('这张卡片已在别处更新，正在刷新复习队列。');
        await load(true);
      } else setError(`评分尚未确认：${errorMessage(cause)}。请重试同一次提交。`);
    } finally { submitLock.current = false; setSubmitting(false); }
  }

  return <div className="page-container review-page"><header className="page-header"><div><span className="eyebrow">DAILY PRACTICE</span><h1>今日复习<span className="heading-leaf">✳</span></h1><p>把遇见过的表达，慢慢变成自己的。</p></div><div className="date-pill">{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}</div></header>
    {data && <div className="review-summary"><div><span className="summary-dot green"/><strong>{data.dueCount}</strong><span>张待复习</span></div><div><span className="summary-dot sand"/><strong>{data.newCount}</strong><span>张新卡</span></div><div className="summary-caption">先复习到期表达，再学习新收藏</div></div>}
    {loading && !data ? <div className="review-card state-card"><div className="loader"/><p>正在准备今天的卡片…</p></div> : null}
    {!data && error && <div className="review-card state-card"><div className="state-mark">!</div><h2>卡片暂时无法加载</h2><p>{error}</p><button className="button primary" onClick={() => void load()}>重试</button></div>}
    {data && !item && <div className="review-card state-card empty-review"><div className="seed-illustration"><span>✳</span></div><span className="eyebrow">ALL CAUGHT UP</span><h2>今天的复习完成了</h2><p>你收藏的表达会在合适的时候再出现。现在可以继续探索新内容。</p><a className="button secondary" href="/notes">看看我的词库 ↗</a></div>}
    {item && <section className="review-card" aria-label="复习卡片"><div className="card-topline"><span className="card-kind">{item.state === 0 ? '新收藏' : '到期复习'}</span><span className="card-count">{data!.items.length} 张待看</span></div><div className="review-prompt"><span className="eyebrow">IN CONTEXT</span><p className="review-sentence"><HighlightedSentence sentence={item.note.sentence} expression={item.note.expression}/></p><div className="question-line">这里的 <strong>{item.note.expression}</strong> 是什么意思？</div></div>{revealed ? <div className="review-answer"><div><span className="answer-label">语境义</span><p className="answer-meaning">{item.note.meaning}</p></div>{item.note.sentenceTranslation && <div><span className="answer-label">整句理解</span><p>{item.note.sentenceTranslation}</p></div>}{item.note.usage && <div><span className="answer-label">用法提示</span><p>{item.note.usage}</p></div>}</div> : <div className="reveal-area"><button className="button primary reveal-button" onClick={() => setRevealed(true)}>显示答案 <span aria-hidden="true">↗</span></button><p>先试着回想，再看答案</p></div>}</section>}
    {item && revealed && <section className="rating-panel"><div className="rating-heading"><h2>刚才想起来了吗？</h2><span>根据回想情况选择</span></div><div className="rating-grid">{([1, 2, 3, 4] as const).map(rating => <button key={rating} disabled={submitting || awaitingRefresh || !!pending && pending.rating !== rating} className={`rating-button rating-${rating}`} onClick={() => void rate(rating)}><strong>{REVIEW_LABELS[rating]}</strong><span>{nextTime(item.intervals[String(rating) as '1'|'2'|'3'|'4'])}</span></button>)}</div><p className="rating-note">看答案后才认出来，请选“没想起来”。</p></section>}
    {item && error && <div className="notice error review-error" role="alert">{awaitingRefresh ? `评分已保存，但下一张卡片加载失败：${error}` : error}{pending && <button className="text-button" disabled={submitting} onClick={() => void rate(pending.rating)}>重试提交</button>}{awaitingRefresh && <button className="text-button" onClick={() => void load(true)}>刷新队列</button>}</div>}
  </div>;
}

export default function ReviewPage() { return <ProtectedApp><ReviewContent/></ProtectedApp>; }
