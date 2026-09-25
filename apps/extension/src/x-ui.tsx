import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ContextPost, Model, TranslationContext, TranslationEvent } from '@sayseed/shared';
import { models, translate, type TranslationStream } from './api';
import { ExplainPanel } from './explain-ui';
import { editorText, replaceEditorText } from './x-dom';
import { captureSelection, type CapturedSelection } from './selection';
import { adjacentPanel, useDraggablePanel } from './draggable-panel';

function PostContext(props: { label: string; post?: ContextPost; onRemove: () => void; onChange: (post: ContextPost) => void }) {
  if (!props.post) return null;
  return <div className="context">
    <div className="row between"><strong>{props.label}</strong><button className="small" onClick={props.onRemove}>移除</button></div>
    <div className="muted">{props.post.author} {props.post.url}</div>
    <textarea aria-label={`${props.label}正文`} value={props.post.text} onChange={e => props.onChange({ ...props.post!, text: e.target.value })} />
    {!props.post.text && !!props.post.images.length && <p className="muted">这条帖子只有图片；可在补充语境中说明需要参考的内容。</p>}
  </div>;
}

export function XAssistant(props: { editor: HTMLElement; initialContext: TranslationContext; isCurrent: () => boolean; onClose: () => void }) {
  const [context, setContext] = useState(props.initialContext);
  const [draft, setDraft] = useState(editorText(props.editor));
  const [output, setOutput] = useState('');
  const [partial, setPartial] = useState('');
  const [status, setStatus] = useState<'idle' | 'streaming' | 'ready' | 'clarification' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [instruction, setInstruction] = useState('');
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState('');
  const [showContext, setShowContext] = useState(false);
  const [explainInput, setExplainInput] = useState<{ input: Pick<CapturedSelection, 'selection' | 'sentence' | 'context'> & { modelId?: string }; sourceUrl: string; sourceTitle: string; draftZh: string } | null>(null);
  const [adopted, setAdopted] = useState<{ before: string; after: string } | null>(null);
  const [position, setPosition] = useState({ top: 12, left: 12 });
  const request = useRef<TranslationStream | null>(null);
  const requestId = useRef(0);
  const sourceDraft = useRef(draft);
  const expectedEditor = useRef(draft);
  const outputElement = useRef<HTMLDivElement>(null);
  const floating = useDraggablePanel(position);
  const explainPlacement = adjacentPanel(floating.point, Math.min(420, window.innerWidth - 24), Math.min(420, window.innerWidth - 24), window.innerWidth);

  useEffect(() => {
    let active = true;
    models().then(list => { if (active) { setAvailableModels(list); setModelId(list.find(model => model.isDefault)?.id || list[0]?.id || ''); } }).catch(e => { if (active) setMessage(e instanceof Error ? e.message : '无法加载模型'); });
    const move = () => {
      const rect = props.editor.getBoundingClientRect();
      const height = Math.min(700, window.innerHeight - 24);
      setPosition({ top: Math.max(12, Math.min(window.innerHeight - height - 12, rect.bottom + 8)), left: Math.max(12, Math.min(window.innerWidth - 432, rect.left)) });
    };
    move(); window.addEventListener('scroll', move, true); window.addEventListener('resize', move);
    const observer = new ResizeObserver(move); observer.observe(props.editor);
    return () => { active = false; requestId.current++; request.current?.cancel(); window.removeEventListener('scroll', move, true); window.removeEventListener('resize', move); observer.disconnect(); };
  }, [props.editor]);

  useEffect(() => { if (editorText(props.editor)) generate(); }, []);
  useLayoutEffect(() => {
    const element = outputElement.current;
    const value = status === 'streaming' ? partial : output;
    if (element && element.innerText !== value) element.innerText = value;
  }, [output, partial, status]);

  function generate() {
    if (!props.isCurrent()) { setStatus('error'); setMessage('回复对象已改变，请重新打开助手'); return; }
    const currentDraft = editorText(props.editor);
    if (!currentDraft) { setMessage('请先在 X 输入框写中文'); return; }
    request.current?.cancel();
    const id = ++requestId.current;
    if (!adopted || currentDraft !== adopted.after) sourceDraft.current = currentDraft;
    expectedEditor.current = currentDraft;
    const previousTranslation = output;
    setDraft(sourceDraft.current); setOutput(''); setPartial(''); setMessage(''); setStatus('streaming'); setExplainInput(null);
    let accumulated = '';
    request.current = translate({ draft: sourceDraft.current, context, ...(modelId ? { modelId } : {}), ...(instruction.trim() ? { instruction } : {}), ...(previousTranslation.trim() ? { previousTranslation } : {}) }, (event: TranslationEvent) => {
      if (id !== requestId.current) return;
      if (event.type === 'delta') { accumulated += event.text; setPartial(accumulated); }
      if (event.type === 'error') { setStatus('error'); setMessage(event.message); }
      if (event.type === 'done') {
        setPartial('');
        if (event.kind === 'clarification') { setStatus('clarification'); setMessage(event.text); }
        else { setOutput(event.text); setStatus('ready'); setInstruction(''); }
      }
    });
  }
  function cancel() { requestId.current++; request.current?.cancel(); request.current = null; setPartial(''); setStatus('idle'); }
  function adopt() {
    if (status !== 'ready' || !output.trim()) return;
    if (!props.isCurrent()) { setMessage('回复对象已改变，已阻止回填'); return; }
    const before = expectedEditor.current;
    if (before === output && editorText(props.editor) === output) { setMessage('这份译文已经采用'); return; }
    if (replaceEditorText(props.editor, before, output)) { setAdopted({ before, after: output }); expectedEditor.current = output; setMessage('已回填到 X。发布前请检查。'); }
    else { setMessage('原输入框已改变，已阻止覆盖；可复制译文。'); }
  }
  function undo() {
    if (!adopted || !props.isCurrent()) { setMessage('回复对象已改变，无法自动撤回'); return; }
    if (replaceEditorText(props.editor, adopted.after, adopted.before)) { expectedEditor.current = adopted.before; setAdopted(null); setMessage('已撤回本次回填'); }
    else { setMessage('输入框已改变，无法自动撤回'); }
  }
  function explainSelection() {
    const element = outputElement.current;
    const shadow = element?.getRootNode() as (ShadowRoot & { getSelection?: () => Selection | null }) | undefined;
    const selection = shadow?.getSelection?.() || window.getSelection();
    if (!element || !selection?.rangeCount || !element.contains(selection.getRangeAt(0).commonAncestorContainer)) { setMessage('请先在英文结果中划选单词或短语'); return; }
    const captured = captureSelection(selection, { allowEditable: true });
    if (!captured) { setMessage('请先在英文结果中划选单词或短语'); return; }
    setExplainInput({ input: { selection: captured.selection, sentence: captured.sentence, context: captured.context, ...(modelId ? { modelId } : {}) }, sourceUrl: context.target?.url || context.quoted?.url || location.href, sourceTitle: document.title, draftZh: sourceDraft.current });
  }
  const updatePost = (kind: 'target' | 'quoted', post?: ContextPost) => setContext(old => ({ ...old, [kind]: post }));
  return <>
    <div ref={floating.ref} className={explainInput && explainPlacement.overlay ? 'panel panel-obscured' : 'panel'} role="dialog" aria-label="Sayseed 英文助手" style={floating.style}>
      <div className="row between drag-handle" {...floating.handleProps}><strong className="title">Sayseed · {context.mode === 'post' ? '发帖' : context.mode === 'quote' ? '引用' : '回复'}</strong><button className="small" onClick={props.onClose}>关闭</button></div>
      <div className="section"><label className="label">模型</label><select value={modelId} onChange={e => setModelId(e.target.value)}>{availableModels.length ? availableModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>) : <option value="">默认模型</option>}</select></div>
      <div className="row"><button className="small" onClick={() => setShowContext(!showContext)}>{showContext ? '收起' : '查看'}上下文</button><span className="muted">中文原稿：{draft.slice(0, 80)}{draft.length > 80 ? '…' : ''}</span></div>
      {!showContext && context.incompleteReasons.map(reason => <p className="notice" key={reason}>{reason}</p>)}
      {showContext && <div className="section">
        <p className="muted">翻译只参考帖子文字；图片不会发送给模型。</p>
        <PostContext label="直接回复对象" post={context.target} onRemove={() => updatePost('target')} onChange={post => updatePost('target', post)} />
        <PostContext label="被引用帖子" post={context.quoted} onRemove={() => updatePost('quoted')} onChange={post => updatePost('quoted', post)} />
        {context.incompleteReasons.map(reason => <p className="notice" key={reason}>{reason}</p>)}
        <label className="label">补充语境</label><textarea value={context.supplement} onChange={e => setContext(old => ({ ...old, supplement: e.target.value }))} placeholder="例如：我是认真请教，不是在反驳" />
      </div>}
      <div className="section"><label className="label">英文结果（可直接编辑）</label><div ref={outputElement} className="output" role="textbox" aria-label="英文结果" contentEditable={status === 'ready'} suppressContentEditableWarning onInput={e => setOutput(e.currentTarget.innerText)} /></div>
      {status === 'clarification' && <p className="notice">需要澄清：{message}</p>}
      {status === 'error' && <p className="error">{message}</p>}
      {status !== 'clarification' && status !== 'error' && message && <p className="notice">{message}</p>}
      <div className="row"><button className="primary" disabled={status === 'streaming'} onClick={generate}>{output ? '重新生成' : '翻译'}</button>{status === 'streaming' && <button onClick={cancel}>停止</button>}<button disabled={!output.trim() || status !== 'ready'} onClick={adopt}>采用</button>{adopted && <button disabled={status === 'streaming'} onClick={undo}>撤回</button>}</div>
      <div className="section"><label className="label">用中文继续修改译文</label><textarea value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="例如：这里想接一下他的玩笑" /><button disabled={!instruction.trim() || status === 'streaming'} onClick={generate}>按要求修改</button></div>
      <div className="row"><button disabled={!output || status !== 'ready'} onMouseDown={e => e.preventDefault()} onClick={explainSelection}>解释选中表达</button><button disabled={!output || status !== 'ready'} onClick={() => void navigator.clipboard.writeText(output).then(() => setMessage('已复制译文')).catch(() => setMessage('复制失败'))}>复制译文</button></div>
    </div>
    {explainInput && <ExplainPanel initial={explainInput.input} sourceKind="translation" sourceUrl={explainInput.sourceUrl} sourceTitle={explainInput.sourceTitle} draftZh={explainInput.draftZh} style={{ top: explainPlacement.point.top, left: explainPlacement.point.left }} onClose={() => setExplainInput(null)} />}
  </>;
}
