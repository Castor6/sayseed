import React, { useEffect, useRef, useState } from 'react';
import type { ExplainInput, Explanation, NoteInput } from '@sayseed/shared';
import { explain, saveNote } from './api';
import { useDraggablePanel } from './draggable-panel';

type Props = {
  initial: ExplainInput;
  sourceKind: 'translation' | 'webpage';
  sourceUrl: string;
  sourceTitle: string;
  draftZh?: string;
  style?: React.CSSProperties;
  onClose: () => void;
};

type Snapshot = {
  input: ExplainInput;
  sourceKind: Props['sourceKind'];
  sourceUrl: string;
  sourceTitle: string;
  draftZh: string;
  propKey: string;
};

type Ready = { explanation: Explanation; snapshot: Snapshot };

function containsSelection(selection: string, sentence: string) {
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return normalize(sentence).includes(normalize(selection));
}

function getError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function ExplainPanel(props: Props) {
  const floating = useDraggablePanel({ top: Number(props.style?.top ?? 12), left: Number(props.style?.left ?? 12) });
  const propKey = JSON.stringify([
    props.initial.selection, props.initial.sentence, props.initial.context,
    props.initial.modelId, props.sourceKind, props.sourceUrl, props.sourceTitle, props.draftZh,
  ]);
  const [selection, setSelection] = useState(props.initial.selection);
  const [sentence, setSentence] = useState(props.initial.sentence);
  const [ready, setReady] = useState<Ready | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const requestVersion = useRef(0);
  const saveVersion = useRef(0);
  const initialRequest = useRef<{ key: string; promise: Promise<Explanation> } | null>(null);

  function snapshot(nextSelection: string, nextSentence: string): Snapshot {
    return {
      input: { ...props.initial, selection: nextSelection.trim(), sentence: nextSentence.trim() },
      sourceKind: props.sourceKind,
      sourceUrl: props.sourceUrl,
      sourceTitle: props.sourceTitle,
      draftZh: props.draftZh || '',
      propKey,
    };
  }

  async function run(next: Snapshot, reuseInitial = false) {
    const version = ++requestVersion.current;
    setReady(null); setSaved(''); setError('');
    if (!next.input.selection || !next.input.sentence) {
      setBusy(false); setError('请填写选中的表达和所在英文句子。'); return;
    }
    if (!containsSelection(next.input.selection, next.input.sentence)) {
      setBusy(false); setError('选中的表达不在当前句子里，请修正句子后重试。'); return;
    }
    setBusy(true);
    try {
      let pending: Promise<Explanation>;
      if (reuseInitial && initialRequest.current?.key === propKey) pending = initialRequest.current.promise;
      else {
        pending = explain(next.input);
        if (reuseInitial) initialRequest.current = { key: propKey, promise: pending };
      }
      const explanation = await pending;
      if (version === requestVersion.current) setReady({ explanation, snapshot: next });
    } catch (cause) {
      if (version === requestVersion.current) setError(getError(cause, '解释失败，请重试。'));
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  }

  useEffect(() => {
    setSelection(props.initial.selection);
    setSentence(props.initial.sentence);
    setReady(null);
    setSaved('');
    void run(snapshot(props.initial.selection, props.initial.sentence), true);
    return () => { requestVersion.current++; saveVersion.current++; };
  }, [propKey]);

  const currentReady = ready?.snapshot.propKey === propKey &&
    ready.snapshot.input.selection === selection.trim() &&
    ready.snapshot.input.sentence === sentence.trim() ? ready : null;

  async function save() {
    if (!currentReady || busy) return;
    const version = ++saveVersion.current;
    const { explanation, snapshot: captured } = currentReady;
    const input: NoteInput = {
      expression: captured.input.selection,
      sentence: captured.input.sentence,
      meaning: explanation.meaning,
      sentenceTranslation: explanation.sentenceTranslation,
      usage: explanation.usage,
      context: captured.input.context || '',
      sourceKind: captured.sourceKind,
      sourceUrl: captured.sourceUrl,
      sourceTitle: captured.sourceTitle,
      draftZh: captured.draftZh,
    };
    setBusy(true); setError('');
    try {
      const response = await saveNote(input);
      if (version === saveVersion.current) setSaved(response.duplicate ? '已在词库中' : '已收藏');
    } catch (cause) {
      if (version === saveVersion.current) setError(getError(cause, '收藏失败，请重试。'));
    } finally {
      if (version === saveVersion.current) setBusy(false);
    }
  }

  function close() {
    requestVersion.current++; saveVersion.current++;
    props.onClose();
  }

  return <div ref={floating.ref} className="panel" role="dialog" aria-label="Sayseed 解释" style={{ ...props.style, ...floating.style }}>
    <div className="row between drag-handle" {...floating.handleProps}><strong className="title">语境解释</strong><button className="small" onClick={close}>关闭</button></div>
    <div className="section"><label className="label">选中的表达</label><input value={selection} disabled={busy} onChange={event => { setSelection(event.target.value); setReady(null); setSaved(''); }} /></div>
    <div className="section"><label className="label">所在英文句子，可修正</label><textarea value={sentence} disabled={busy} onChange={event => { setSentence(event.target.value); setReady(null); setSaved(''); }} /></div>
    <button className="primary" disabled={busy || !selection.trim() || !sentence.trim()} onClick={() => void run(snapshot(selection, sentence))}>{busy && !currentReady ? '解释中…' : currentReady ? '重新解释' : error ? '重试解释' : '解释'}</button>
    {currentReady && <div className="section"><strong>{currentReady.explanation.meaning}</strong><p>{currentReady.explanation.sentenceTranslation}</p>{currentReady.explanation.usage && <p className="muted">{currentReady.explanation.usage}</p>}<button disabled={busy} onClick={() => void save()}>收藏</button>{saved && <span className="muted"> {saved}</span>}</div>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
