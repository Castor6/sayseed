'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PROMPT_BODY_LIMIT, type PromptDraft, type PromptHistoryResult, type PromptKind, type PromptRevision, type PromptSetting } from '@sayseed/shared';
import { ProtectedApp, allowAppNavigation } from '@/components/ProtectedApp';
import { api, ApiError, errorMessage } from '@/components/api';

const labels: Record<PromptKind, string> = { translate: '翻译系统提示词', explain: '表达解释系统提示词' };
type EditorDraft = { mode: 'default' | 'custom'; body: string };
const draftOf = (prompt: PromptSetting): EditorDraft => ({ mode: prompt.mode, body: prompt.body });
const payloadOf = (draft: EditorDraft): PromptDraft => draft.mode === 'default' ? { mode: 'default' } : { mode: 'custom', body: draft.body };

function PromptContent() {
  const [kind, setKind] = useState<PromptKind>('translate');
  const [current, setCurrent] = useState<PromptSetting | null>(null);
  const [draft, setDraft] = useState<EditorDraft>({ mode: 'default', body: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [history, setHistory] = useState<PromptHistoryResult | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [preview, setPreview] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const generation = useRef(0);
  const editVersion = useRef(0);
  const previewVersion = useRef(0);
  const historyVersion = useRef(0);
  const dirty = !!current && (draft.mode !== current.mode || draft.body !== current.body);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const invalid = draft.body.length > PROMPT_BODY_LIMIT ? `正文不能超过 ${PROMPT_BODY_LIMIT.toLocaleString('zh-CN')} 字符。` : !draft.body.trim() ? '提示词正文不能为空。' : '';

  useEffect(() => {
    const href = window.location.href;
    const state = window.history.state;
    const confirmLeave = () => !dirtyRef.current || window.confirm('提示词有未保存的修改，确定放弃并离开吗？');
    const onNavigate = (event: Event) => { if (!confirmLeave()) event.preventDefault(); };
    const onUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    const onPop = (event: PopStateEvent) => {
      if (!confirmLeave()) {
        event.stopImmediatePropagation();
        window.history.pushState(state, '', href);
      }
    };
    window.addEventListener('sayseed:before-navigate', onNavigate);
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('popstate', onPop, true);
    return () => {
      window.removeEventListener('sayseed:before-navigate', onNavigate);
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('popstate', onPop, true);
    };
  }, []);

  const load = useCallback(async (keepDraft = false) => {
    const request = ++generation.current;
    previewVersion.current++; historyVersion.current++;
    setPreview(''); setPreviewLoading(false); setPreviewError('');
    setHistory(null); setHistoryLoading(false); setHistoryError('');
    const edit = editVersion.current;
    setLoading(true); setError('');
    try {
      const result = await api<{ prompt: PromptSetting }>(`/prompts/${kind}`);
      if (request !== generation.current) return;
      setCurrent(result.prompt);
      if (!keepDraft && edit === editVersion.current) setDraft(draftOf(result.prompt));
      else setDraft(previous => previous.mode === 'default' && previous.body !== result.prompt.defaultBody ? { ...previous, mode: 'custom' } : previous);
      setConflict(false);
      if (keepDraft) setMessage('已读取最新生效版本，保留了你的草稿。请核对正文和固定规则后再保存。');
    } catch (cause) { if (request === generation.current) setError(errorMessage(cause)); }
    finally { if (request === generation.current) setLoading(false); }
  }, [kind]);
  useEffect(() => { void load(); return () => { generation.current++; previewVersion.current++; historyVersion.current++; }; }, [load]);

  function edit(next: EditorDraft, notice = '') {
    editVersion.current++; previewVersion.current++;
    setDraft(next); setPreview(''); setPreviewLoading(false); setPreviewError(''); setMessage(notice);
  }
  function switchKind(next: PromptKind) {
    if (next === kind || saving || !allowAppNavigation()) return;
    generation.current++; historyVersion.current++; previewVersion.current++;
    setCurrent(null); setHistory(null); setHistoryError(''); setHistoryLoading(false); setPreview(''); setPreviewError(''); setPreviewLoading(false); setError(''); setMessage(''); setConflict(false); setLoading(true); setKind(next);
  }
  async function save() {
    if (!current || invalid || saving || loading) return;
    const request = generation.current;
    const edit = editVersion.current;
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await api<{ prompt: PromptSetting }>(`/prompts/${kind}`, { method: 'PATCH', body: JSON.stringify({ ...payloadOf(draft), revision: current.revision, defaultVersion: current.defaultVersion, protocolVersion: current.protocolVersion }) });
      if (request !== generation.current) return;
      setCurrent(result.prompt);
      if (edit === editVersion.current) setDraft(draftOf(result.prompt));
      historyVersion.current++; setHistoryLoading(false); setHistoryError('');
      setConflict(false); setHistory(null);
      setMessage(edit === editVersion.current ? '已保存并生效，新请求将使用此版本。' : '提交的版本已生效；你在保存期间的新修改仍是未保存草稿。');
    } catch (cause) {
      if (request !== generation.current) return;
      setConflict(cause instanceof ApiError && cause.status === 409);
      setError(errorMessage(cause));
    } finally { if (request === generation.current) setSaving(false); }
  }
  async function showPreview() {
    if (invalid) return;
    const request = ++previewVersion.current;
    setPreviewLoading(true); setPreviewError('');
    try {
      const result = await api<{ system: string }>(`/prompts/${kind}/preview`, { method: 'POST', body: JSON.stringify(payloadOf(draft)) });
      if (request === previewVersion.current) setPreview(result.system);
    } catch (cause) { if (request === previewVersion.current) setPreviewError(errorMessage(cause)); }
    finally { if (request === previewVersion.current) setPreviewLoading(false); }
  }
  async function loadHistory(offset = 0) {
    const request = ++historyVersion.current;
    setHistoryLoading(true); setHistoryError('');
    try {
      const result = await api<PromptHistoryResult>(`/prompts/${kind}/history?limit=10&offset=${offset}`);
      if (request === historyVersion.current) setHistory(result);
    } catch (cause) { if (request === historyVersion.current) setHistoryError(errorMessage(cause)); }
    finally { if (request === historyVersion.current) setHistoryLoading(false); }
  }
  function restore(revision?: PromptRevision) {
    if (!current || (dirty && !window.confirm('确定替换当前未保存的草稿吗？'))) return;
    const mode = revision ? revision.mode === 'default' && revision.defaultVersion === current.defaultVersion ? 'default' : 'custom' : 'default';
    edit({ mode, body: revision?.body ?? current.defaultBody }, revision ? `已载入版本 ${revision.revision} 的正文，保存后才生效。使用当前应用固定规则${revision.defaultVersion !== current.defaultVersion ? '；旧版正文将作为自定义保存' : ''}。` : '已载入内置默认正文，保存后才生效。');
  }

  return <div className="page-container settings-page prompt-page">
    <Link href="/settings" className="text-button prompt-back" onNavigate={event => { if (!allowAppNavigation()) event.preventDefault(); }}>← 返回设置</Link>
    <header className="page-header"><div><span className="eyebrow">SYSTEM PROMPTS</span><h1>提示词<span className="heading-leaf">✳</span></h1><p>调整翻译与解释方式。所有模型共用，保存后供新请求使用。</p></div></header>
    <div className="prompt-tabs" role="group" aria-label="提示词用途">{(Object.keys(labels) as PromptKind[]).map(value => <button className={`button ${kind === value ? 'primary' : 'secondary'}`} key={value} aria-pressed={kind === value} disabled={saving} onClick={() => switchKind(value)}>{labels[value]}</button>)}</div>
    {loading && <div className="notice" role="status">正在读取提示词…</div>}
    {error && <div className="notice error" role="alert">{error}{conflict && <p>生效版本已变化，你的草稿仍保留。重新读取后可核对并再次保存。</p>}<button className="text-button" disabled={loading || saving} onClick={() => void load(!!current)}>{current ? '读取最新版本并保留草稿' : '重试'}</button></div>}
    {message && <div className="notice success" role="status">{message}</div>}
    {current && <>
      <section className="settings-section">
        <div className="section-header"><div><h2>{labels[kind]}</h2><p>当前生效：{current.mode === 'default' ? '内置默认' : '自定义'} · 版本 {current.revision}</p></div><span className="status-chip ready">{dirty ? '有未保存修改' : '已与生效版本同步'}</span></div>

        <label className="prompt-editor-label" htmlFor="prompt-body">提示词正文 <span>草稿：{draft.mode === 'default' ? '内置默认' : '自定义'}</span></label>
        <textarea id="prompt-body" className="prompt-editor" spellCheck={false} value={draft.body} aria-invalid={!!invalid} aria-describedby="prompt-body-status" onChange={event => edit({ mode: 'custom', body: event.target.value })}/>
        <div className="prompt-body-status" id="prompt-body-status"><span className={invalid ? 'prompt-error' : ''}>{invalid || '编辑正文会切换为自定义；保存前不会影响模型调用。'}</span><span>{draft.body.length.toLocaleString('zh-CN')} / {PROMPT_BODY_LIMIT.toLocaleString('zh-CN')}</span></div>
        <div className="prompt-actions"><button className="button secondary" disabled={saving || loading} onClick={() => restore()}>载入内置默认</button><button className="button secondary" disabled={!!invalid || previewLoading || loading} onClick={() => void showPreview()}>{previewLoading ? '正在预览…' : '预览最终提示词'}</button><button className="button primary" disabled={!dirty || !!invalid || saving || loading || conflict} onClick={() => void save()}>{saving ? '保存中…' : '保存并生效'}</button></div>
        <p className="prompt-help">保存只影响后续请求，正在生成的内容继续使用原版本。预览不会调用模型，也不会保存草稿。</p>
        {previewError && <div className="notice error" role="alert">{previewError}<button className="text-button" onClick={() => void showPreview()}>重试预览</button></div>}
        {preview && <details className="prompt-details" open><summary>最终提示词预览（当前草稿）</summary><pre>{preview}</pre></details>}
        <details className="prompt-details"><summary>版本详情</summary><p className="prompt-version">默认正文版本：{current.defaultVersion}<br/>应用规则版本：{current.protocolVersion}</p></details>
        <details className="prompt-details"><summary>应用固定规则（只读）</summary><p>输出格式和材料边界由应用统一维护，每次请求都会附加。</p><pre>{current.fixedRules}</pre></details>
      </section>
      <section className="settings-section"><div className="section-header"><div><h2>历史版本</h2><p>载入历史正文后，仍需点击“保存并生效”。应用固定规则使用当前版本。</p></div><button className="button secondary" disabled={historyLoading || saving} onClick={() => void loadHistory()}>{historyLoading ? '读取中…' : history ? '刷新历史' : '查看历史'}</button></div>
        {historyError && <div className="notice error" role="alert">{historyError}<button className="text-button" onClick={() => void loadHistory()}>重试</button></div>}
        {history && !historyLoading && !historyError && <><div className="prompt-history">{history.items.length ? history.items.map(item => <div key={item.revision} className="prompt-history-row"><div><strong>版本 {item.revision} · {item.mode === 'default' ? '内置默认' : '自定义'}</strong><span>{item.updatedAt ? new Date(item.updatedAt).toLocaleString('zh-CN') : '初始内置版本'}</span></div><button className="text-button" disabled={saving || loading} onClick={() => restore(item)}>载入正文</button></div>) : <p className="muted">还没有保存历史。</p>}</div>{history.total > history.limit && <div className="usage-pagination"><span>共 {history.total} 个版本</span><button className="button secondary" disabled={!history.offset} onClick={() => void loadHistory(Math.max(0, history.offset - history.limit))}>上一页</button><button className="button secondary" disabled={history.offset + history.limit >= history.total} onClick={() => void loadHistory(history.offset + history.limit)}>下一页</button></div>}</>}
      </section>
    </>}
  </div>;
}

export default function PromptsPage() { return <ProtectedApp><PromptContent/></ProtectedApp>; }
