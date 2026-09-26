'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UsageDetail, UsagePurpose, UsageRecord, UsageResult, UsageStatus, UsageTokenSummary } from '@sayseed/shared';
import { ProtectedApp } from '@/components/ProtectedApp';
import { api, errorMessage } from '@/components/api';
import { reasoningEffortLabel } from '@/components/reasoning-label';

const purposeLabels: Record<UsagePurpose, string> = { translate: '翻译', explain: '划词解释', test: '模型测试' };
const statusLabels: Record<UsageStatus, string> = { success: '成功', error: '失败', cancelled: '已取消' };
const errorLabels: Record<string, string> = {
  provider_error: '模型服务调用失败', timeout: '请求超时', invalid_output: '模型输出无法使用',
  incomplete: '模型输出未完成', cancelled: '已取消',
};
const pageSize = 30;
const roleLabels = { user: '用户输入', assistant: '助手消息', system: '系统消息' } as const;

function tokenText(value: number | null) { return value === null ? '未知' : value.toLocaleString('zh-CN'); }
function summaryText(value: UsageTokenSummary, calls: number) {
  if (calls > 0 && value.unknownCount === calls) return <>未知<small>{calls} 次均未提供</small></>;
  return <>{value.knownSum.toLocaleString('zh-CN')}{value.unknownCount > 0 && <small>另有 {value.unknownCount} 次未知</small>}</>;
}

function UsageContent() {
  const [purpose, setPurpose] = useState('');
  const [status, setStatus] = useState('');
  const [modelId, setModelId] = useState('');
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<UsageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true);
    const search = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (purpose) search.set('purpose', purpose);
    if (status) search.set('status', status);
    if (modelId) search.set('modelId', modelId);
    try {
      const next = await api<UsageResult>(`/usage?${search}`);
      if (current === requestId.current) { setResult(next); setError(''); }
    } catch (cause) { if (current === requestId.current) setError(errorMessage(cause)); }
    finally { if (current === requestId.current) setLoading(false); }
  }, [purpose, status, modelId, offset]);
  useEffect(() => { void load(); }, [load]);

  const changePurpose = (value: string) => { setLoading(true); setError(''); setPurpose(value); setOffset(0); };
  const changeStatus = (value: string) => { setLoading(true); setError(''); setStatus(value); setOffset(0); };
  const changeModel = (value: string) => { setLoading(true); setError(''); setModelId(value); setOffset(0); };
  const visibleResult = loading || error ? null : result;
  const summary = visibleResult?.summary;
  return <div className="page-container usage-page">
    <header className="page-header"><div><span className="eyebrow">MODEL ACTIVITY</span><h1>模型使用记录<span className="heading-leaf">✳</span></h1><p>查看每次模型调用的内容、结果和服务方返回的 token 用量。</p></div></header>
    <div className="usage-filters">
      <label>用途<select value={purpose} onChange={event => changePurpose(event.target.value)}><option value="">全部用途</option>{Object.entries(purposeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>状态<select value={status} onChange={event => changeStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>模型<select value={modelId} onChange={event => changeModel(event.target.value)}><option value="">全部模型</option>{result?.models.map(model => <option key={model.id} value={model.id}>{model.name} · {model.modelId}</option>)}</select></label>
      <button className="button secondary" type="button" onClick={() => void load()} disabled={loading}>刷新</button>
    </div>
    {error && <div className="notice error" role="alert">{error}<button className="text-button" onClick={() => void load()}>重试</button></div>}
    {summary && <div className="usage-summary">
      <div><span>当前筛选记录</span><strong>{summary.calls.toLocaleString('zh-CN')}</strong><small>成功 {summary.success} · 失败 {summary.error} · 取消 {summary.cancelled}</small></div>
      <div><span>输入 token</span><strong>{summaryText(summary.inputTokens, summary.calls)}</strong></div>
      <div><span>输出 token</span><strong>{summaryText(summary.outputTokens, summary.calls)}</strong></div>
      <div><span>总 token</span><strong>{summaryText(summary.totalTokens, summary.calls)}</strong></div>
      <div><span>推理 token</span><strong>{summaryText(summary.reasoningTokens, summary.calls)}</strong></div>
      <div><span>缓存读取 token</span><strong>{summaryText(summary.cacheReadTokens, summary.calls)}</strong></div>
      <div><span>缓存写入 token</span><strong>{summaryText(summary.cacheWriteTokens, summary.calls)}</strong></div>
    </div>}
    {loading && !error && <div className="state-card" role="status"><div className="loader"/><p>正在读取模型使用记录…</p></div>}
    {visibleResult?.items.length === 0 && <div className="state-card"><h2>还没有匹配的记录</h2><p>完成一次翻译、划词解释或模型测试后会出现在这里。</p></div>}
    {visibleResult && visibleResult.items.length > 0 && <div className="usage-list">{visibleResult.items.map(item => <UsageItem key={item.id} item={item}/>)}</div>}
    {visibleResult && visibleResult.total > pageSize && <div className="usage-pagination"><span>显示 {offset + 1}–{Math.min(offset + pageSize, visibleResult.total)} 条，共 {visibleResult.total} 条</span><button className="button secondary" disabled={offset === 0} onClick={() => { setLoading(true); setOffset(Math.max(0, offset - pageSize)); }}>上一页</button><button className="button secondary" disabled={offset + pageSize >= visibleResult.total} onClick={() => { setLoading(true); setOffset(offset + pageSize); }}>下一页</button></div>}
    <p className="usage-note">token 数量由模型服务返回；“未知”表示服务未提供该项，并非 0。完整调用内容从此功能更新后的新记录开始保存；旧记录可能只有用量信息。</p>
  </div>;
}

function UsageItem({ item }: { item: UsageRecord }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<UsageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const requestVersion = useRef(0);
  useEffect(() => () => { requestVersion.current++; }, []);

  async function loadDetail() {
    const current = ++requestVersion.current;
    setLoading(true);
    setError('');
    try {
      const next = await api<UsageDetail>(`/usage/${encodeURIComponent(item.id)}`);
      if (current === requestVersion.current) setDetail(next);
    } catch (cause) { if (current === requestVersion.current) setError(errorMessage(cause)); }
    finally { if (current === requestVersion.current) setLoading(false); }
  }

  async function copyText(value: string) {
    try { await navigator.clipboard.writeText(value); setCopyMessage('已复制'); }
    catch { setCopyMessage('复制失败，请手动选择文本'); }
  }

  return <article className="usage-item">
    <div className="usage-item-head"><div><strong>{item.modelName}</strong><span className={`usage-status ${item.status}`}>{statusLabels[item.status]}</span></div><time dateTime={item.startedAt}>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.startedAt))}</time></div>
    <p className="usage-item-meta">{purposeLabels[item.purpose]} · {item.connectionName || '已删除的供应商'} · {item.provider} · {item.modelId} · {item.durationMs.toLocaleString('zh-CN')} 毫秒</p>
    <div className="usage-item-tokens"><span>输入 {tokenText(item.inputTokens)}</span><span>输出 {tokenText(item.outputTokens)}</span><span>总计 {tokenText(item.totalTokens)}</span><span>推理 {tokenText(item.reasoningTokens)}</span><span>缓存读取 {tokenText(item.cacheReadTokens)}</span><span>缓存写入 {tokenText(item.cacheWriteTokens)}</span></div>
    <p className="usage-item-foot">推理设置：{item.reasoningEffort === null ? '跟随服务商' : reasoningEffortLabel(item.reasoningEffort)}{item.errorCode && <> · {errorLabels[item.errorCode] ?? '调用未完成'}</>}</p>
    <div className="usage-item-actions"><button type="button" className="text-button" aria-expanded={open} aria-controls={`usage-context-${item.id}`} onClick={() => { setOpen(!open); if (!open && !detail && !loading && !error) void loadDetail(); }}>{open ? '收起上下文' : '查看上下文'}</button></div>
    {open && <div className="usage-context" id={`usage-context-${item.id}`}>
      {loading && <p className="usage-context-state" role="status">正在读取完整调用内容…</p>}
      {error && <div className="notice error" role="alert">{error}<button type="button" className="text-button" onClick={() => void loadDetail()}>重试</button></div>}
      {detail && !loading && !error && (detail.context ? <>
        <div className="usage-context-header"><strong>调用时的内容</strong><button type="button" className="text-button" onClick={() => void copyText(JSON.stringify(detail.context, null, 2))}>复制完整上下文</button></div>
        <p className="usage-context-state">{item.purpose === 'test' ? '提示词来源：固定连接测试指令' : detail.context.prompt ? `提示词来源：${detail.context.prompt.mode === 'default' ? '内置默认' : '自定义'} · 配置版本 ${detail.context.prompt.revision} · 默认正文版本 ${detail.context.prompt.defaultVersion} · 应用规则版本 ${detail.context.prompt.protocolVersion}` : '提示词版本未记录'}</p>
        <UsageTextBlock title="系统提示词" value={detail.context.system} empty="未设置系统提示词" onCopy={copyText}/>
        <div className="usage-context-section"><h4>完整输入</h4>{detail.context.messages.length ? detail.context.messages.map((message, messageIndex) => <div className="usage-message" key={messageIndex}>
          <div className="usage-message-role">{roleLabels[message.role]} · 第 {messageIndex + 1} 条</div>
          {message.content.map((part, partIndex) => part.type === 'text'
            ? <UsageTextBlock key={partIndex} title={`文本 ${partIndex + 1}`} value={part.text} empty="空文本" onCopy={copyText}/>
            : <div className="usage-image-block" key={partIndex}><div className="usage-block-head"><strong>图片 {partIndex + 1}</strong><span>{part.mediaType}</span></div>
              {/^data:image\/(?:png|jpeg|webp);base64,/i.test(part.data) ? <img src={part.data} alt={`输入图片 ${partIndex + 1}`}/> : <p className="usage-context-state">无法预览此图片格式</p>}
              {part.source && <p className="usage-image-source">来源：{part.source}</p>}
            </div>)}</div>) : <p className="usage-context-state">未保存输入消息。</p>}</div>
        <UsageTextBlock title="请求选项" value={JSON.stringify(detail.context.options, null, 2)} onCopy={copyText}/>
        <div className="usage-context-section"><h4>模型输出</h4>{item.status !== 'success' && <p className="usage-context-state">截至结束时已收到的输出（可能不完整）。</p>}
          {detail.context.output ? <><UsageTextBlock title="回复文本" value={detail.context.output.text} empty="没有回复文本" onCopy={copyText}/><UsageTextBlock title="模型返回的思考内容" value={detail.context.output.reasoning} empty="未记录到思考内容" onCopy={copyText}/></> : <p className="usage-context-state">未收到模型输出。</p>}</div>
        {copyMessage && <p className="usage-copy-feedback" role="status">{copyMessage}</p>}
      </> : <p className="usage-context-state">这条历史记录未保存上下文。</p>)}
    </div>}
  </article>;
}

function UsageTextBlock({ title, value, empty = '无内容', onCopy }: { title: string; value: string | null; empty?: string; onCopy: (value: string) => void | Promise<void> }) {
  return <div className="usage-text-block"><div className="usage-block-head"><strong>{title}</strong>{value !== null && <button type="button" className="text-button" onClick={() => void onCopy(value)}>复制</button>}</div>
    {value ? <pre className="usage-context-text">{value}</pre> : <p className="usage-context-state">{empty}</p>}
  </div>;
}

export default function UsagePage() { return <ProtectedApp><UsageContent/></ProtectedApp>; }
