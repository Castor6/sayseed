'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { Note, NoteInput } from '@sayseed/shared';
import { ProtectedApp } from '@/components/ProtectedApp';
import { HighlightedSentence } from '@/components/HighlightedSentence';
import { api, errorMessage } from '@/components/api';

type NotesResponse = { notes: Note[] };

function NoteEditor({ note, onClose, onSaved, onDeleted }: { note: Note; onClose: () => void; onSaved: (value: Note) => void; onDeleted: (id: string) => void }) {
  const [form, setForm] = useState<NoteInput>({ expression: note.expression, sentence: note.sentence, meaning: note.meaning, sentenceTranslation: note.sentenceTranslation, usage: note.usage, context: note.context, sourceKind: note.sourceKind, sourceUrl: note.sourceUrl, sourceTitle: note.sourceTitle, draftZh: note.draftZh });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  function change(key: keyof NoteInput, value: string) { setForm(previous => ({ ...previous, [key]: value })); }

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api<{ note: Note }>(`/notes/${encodeURIComponent(note.id)}`, { method: 'PATCH', body: JSON.stringify(form) });
      onSaved(result.note); onClose();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function toggleSuspend() {
    setBusy(true); setError('');
    try {
      const result = await api<{ note: Note }>(`/notes/${encodeURIComponent(note.id)}`, { method: 'PATCH', body: JSON.stringify({ suspended: !note.suspended }) });
      onSaved(result.note); onClose();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setError('');
    try {
      await api(`/notes/${encodeURIComponent(note.id)}`, { method: 'DELETE' });
      onDeleted(note.id); onClose();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="edit-heading"><div className="modal-header"><div><span className="eyebrow">YOUR COLLECTION</span><h2 id="edit-heading">编辑收藏</h2></div><button className="icon-button" aria-label="关闭" onClick={onClose}>×</button></div><form onSubmit={save} className="note-form"><label>表达<input required maxLength={2000} value={form.expression} onChange={e => change('expression', e.target.value)}/></label><label>英文原句<textarea required rows={3} maxLength={12000} value={form.sentence} onChange={e => change('sentence', e.target.value)}/></label><label>语境义<textarea required rows={2} maxLength={12000} value={form.meaning} onChange={e => change('meaning', e.target.value)}/></label><label>整句理解<textarea rows={2} maxLength={16000} value={form.sentenceTranslation} onChange={e => change('sentenceTranslation', e.target.value)}/></label><label>用法提示<textarea rows={2} maxLength={12000} value={form.usage} onChange={e => change('usage', e.target.value)}/></label><details className="more-fields"><summary>来源与背景</summary><label>网页标题<input value={form.sourceTitle} maxLength={500} onChange={e => change('sourceTitle', e.target.value)}/></label><label>来源链接<input value={form.sourceUrl} maxLength={2048} onChange={e => change('sourceUrl', e.target.value)}/></label><label>背景文字<textarea rows={2} maxLength={20000} value={form.context} onChange={e => change('context', e.target.value)}/></label><label>中文草稿<textarea rows={2} maxLength={20000} value={form.draftZh} onChange={e => change('draftZh', e.target.value)}/></label></details>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="text-button" disabled={busy} onClick={toggleSuspend}>{note.suspended ? '恢复复习' : '暂停复习'}</button><button type="button" className="text-button danger" disabled={busy} onClick={() => setConfirmDelete(true)}>删除</button><span className="action-spacer"/><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={busy || !form.expression.trim() || !form.sentence.trim() || !form.meaning.trim()}>{busy ? '保存中…' : '保存修改'}</button></div></form>{confirmDelete && <div className="confirm-overlay" role="alertdialog" aria-modal="true" aria-label="确认删除"><div className="confirm-box"><h3>删除这条收藏？</h3><p>相关复习进度也会一并删除，此操作无法撤销。</p><div className="confirm-actions"><button className="button secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>保留</button><button className="button danger-button" disabled={busy} onClick={remove}>{busy ? '删除中…' : '确认删除'}</button></div></div></div>}</section></div>;
}

function NotesContent() {
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Note | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (value: string) => {
    const current = ++requestId.current;
    setLoading(true);
    try { const result = await api<NotesResponse>(`/notes?q=${encodeURIComponent(value)}`); if (current === requestId.current) { setNotes(result.notes); setError(''); } }
    catch (cause) { if (current === requestId.current) setError(errorMessage(cause)); }
    finally { if (current === requestId.current) setLoading(false); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => void load(query), query ? 250 : 0); return () => clearTimeout(timer); }, [query, load]);

  function update(note: Note) { requestId.current++; setLoading(false); setNotes(previous => previous.map(value => value.id === note.id ? note : value)); setSelected(note); }

  return <div className="page-container notes-page"><header className="page-header"><div><span className="eyebrow">YOUR COLLECTION</span><h1>我的词库<span className="heading-leaf">✳</span></h1><p>把读懂过的表达，留在属于它的句子里。</p></div><div className="count-pill">{notes.length} 条收藏</div></header><div className="search-wrap"><span aria-hidden="true">⌕</span><input aria-label="搜索词库" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索表达、原句或含义"/><span className="search-hint">搜索</span></div>{error && <div className="notice error" role="alert">{error}<button className="text-button" onClick={() => void load(query)}>重试</button></div>}{loading && notes.length === 0 && !error && <div className="state-card"><div className="loader"/><p>正在整理你的收藏…</p></div>}{!loading && notes.length === 0 && !error && <div className="state-card empty-notes"><div className="seed-illustration"><span>✳</span></div><h2>{query ? '没有找到匹配的表达' : '词库还没有收藏'}</h2><p>{query ? '换个关键词试试。' : '在网页上划选英文，点击“解释”后就能收藏；也可以从 X 翻译结果中收藏。'}</p></div>}<div className="notes-list">{notes.map(note => <article className="note-card" key={note.id}><div className="note-card-top"><span className="note-source">{note.sourceKind === 'translation' ? '来自翻译' : '来自网页'}</span>{note.suspended && <span className="suspended-badge">已暂停</span>}<span className="note-date">{new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(note.createdAt))}</span></div><h2>{note.expression}</h2><p className="note-meaning">{note.meaning}</p><p className="note-sentence"><HighlightedSentence sentence={note.sentence} expression={note.expression}/></p><div className="note-card-bottom"><span>{note.sourceTitle || (note.sourceKind === 'translation' ? 'X 中的表达' : '网页中的表达')}</span><button className="text-button" onClick={() => setSelected(note)}>查看与编辑 <span aria-hidden="true">↗</span></button></div></article>)}</div>{selected && <NoteEditor key={selected.id} note={selected} onClose={() => setSelected(null)} onSaved={update} onDeleted={id => { requestId.current++; setLoading(false); setNotes(previous => previous.filter(note => note.id !== id)); }}/>}</div>;
}

export default function NotesPage() { return <ProtectedApp><NotesContent/></ProtectedApp>; }
