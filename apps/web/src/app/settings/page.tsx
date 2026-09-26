'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { Connection, DiscoveredModel, DiscoveredModelsResult, Model, ModelCapabilities, Provider, ReasoningEffort } from '@sayseed/shared';
import { ProtectedApp } from '@/components/ProtectedApp';
import { api, errorMessage } from '@/components/api';
import { ModelPicker } from '@/components/ModelPicker';
import { reasoningEffortLabel } from '@/components/reasoning-label';

const providerNames: Record<Provider, string> = { openai: 'OpenAI Responses', anthropic: 'Anthropic', google: 'Google', 'openai-compatible': 'OpenAI Chat Completions' };
type ConnectionForm = { name: string; provider: Provider; baseUrl: string; apiKey: string };
type ModelForm = { connectionId: string; name: string; modelId: string; supportsImages: boolean; isDefault: boolean; capabilities: ModelCapabilities; reasoningEffort: ReasoningEffort | null };
const blankConnection: ConnectionForm = { name: '', provider: 'openai', baseUrl: '', apiKey: '' };
const blankModel: ModelForm = { connectionId: '', name: '', modelId: '', supportsImages: false, isDefault: false, capabilities: {}, reasoningEffort: null };

function capabilityText(value?: number) { return value === undefined ? '未知' : `${value.toLocaleString('zh-CN')} tokens`; }

function knownLimitText(capabilities?: ModelCapabilities) {
  if (!capabilities) return '';
  return [
    capabilities.contextWindow !== undefined && `上下文 ${capabilityText(capabilities.contextWindow)}`,
    capabilities.maxInputTokens !== undefined && `输入上限 ${capabilityText(capabilities.maxInputTokens)}`,
    capabilities.maxOutputTokens !== undefined && `最大输出 ${capabilityText(capabilities.maxOutputTokens)}`,
  ].filter(Boolean).join(' · ');
}

function applyDiscovered(form: ModelForm, model: DiscoveredModel, keepManualImageChoice: boolean): ModelForm {
  const capabilities = model.capabilities ?? {};
  return {
    ...form,
    capabilities,
    supportsImages: keepManualImageChoice ? form.supportsImages : capabilities.supportsImages ?? false,
    reasoningEffort: form.reasoningEffort && capabilities.reasoningEffortLevels?.includes(form.reasoningEffort) ? form.reasoningEffort : null,
  };
}

function CapabilitySummary({ capabilities, supportsImages }: { capabilities: ModelCapabilities; supportsImages: boolean }) {
  const imageLabel = capabilities.supportsImages === undefined
    ? `列表未标注，当前${supportsImages ? '手动开启' : '未开启'}`
    : capabilities.supportsImages === supportsImages
      ? `列表标注${supportsImages ? '支持' : '不支持'}图片`
      : `列表标注${capabilities.supportsImages ? '支持' : '不支持'}图片，当前使用手动设置`;
  return <div className="capability-summary" aria-live="polite">
    <div><span>图片理解</span><strong>{imageLabel}</strong></div>
    <div><span>上下文窗口</span><strong>{capabilityText(capabilities.contextWindow)}</strong></div>
    <div><span>输入上限</span><strong>{capabilityText(capabilities.maxInputTokens)}</strong></div>
    <div><span>最大输出</span><strong>{capabilityText(capabilities.maxOutputTokens)}</strong></div>
  </div>;
}

function SettingsContent() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editingConnection, setEditingConnection] = useState<string | null>(null);
  const [connectionForm, setConnectionForm] = useState<ConnectionForm>(blankConnection);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [modelForm, setModelForm] = useState<ModelForm>(blankModel);
  const [modelPickerSession, setModelPickerSession] = useState(0);
  const modelPickerGeneration = useRef(0);
  const activeModelConnection = useRef(modelForm.connectionId);
  const activeModelEditing = useRef(editingModel);
  activeModelConnection.current = modelForm.connectionId;
  activeModelEditing.current = editingModel;
  const manualImageChoice = useRef(false);
  const [testingId, setTestingId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'connection' | 'model'; id: string; name: string } | null>(null);

  const invalidateModelPicker = useCallback(() => {
    setModelPickerSession(++modelPickerGeneration.current);
  }, []);

  const load = useCallback(async () => {
    invalidateModelPicker();
    setLoading(true);
    try {
      const [connectionResult, modelResult] = await Promise.all([api<{ connections: Connection[] }>('/connections'), api<{ models: Model[] }>('/models')]);
      setConnections(connectionResult.connections); setModels(modelResult.models); setError('');
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }, [invalidateModelPicker]);
  useEffect(() => { void load(); }, [load]);

  function editConnection(connection?: Connection) {
    setEditingConnection(connection?.id ?? 'new'); setError(''); setMessage('');
    setConnectionForm(connection ? { name: connection.name, provider: connection.provider, baseUrl: connection.baseUrl, apiKey: '' } : blankConnection);
  }
  function editModel(model?: Model) {
    setEditingModel(model?.id ?? 'new'); setError(''); setMessage('');
    invalidateModelPicker();
    manualImageChoice.current = !!model && (
      model.capabilities?.supportsImages === undefined
        ? model.supportsImages
        : model.supportsImages !== model.capabilities.supportsImages
    );
    setModelForm(model ? { connectionId: model.connectionId, name: model.name, modelId: model.modelId, supportsImages: model.supportsImages, isDefault: model.isDefault, capabilities: model.capabilities ?? {}, reasoningEffort: model.reasoningEffort } : { ...blankModel, connectionId: connections[0]?.id ?? '' });
  }

  function changeModelConnection(connectionId: string) {
    manualImageChoice.current = false;
    setModelForm(previous => ({ ...previous, connectionId, modelId: '', capabilities: {}, supportsImages: false, reasoningEffort: null }));
  }

  function changeModelId(modelId: string) {
    manualImageChoice.current = false;
    setModelForm(previous => ({ ...previous, modelId, capabilities: {}, supportsImages: false, reasoningEffort: null }));
  }

  function selectDiscovered(model: DiscoveredModel, session: number) {
    if (session !== modelPickerGeneration.current) return;
    const currentConnectionId = modelForm.connectionId;
    const sameId = modelForm.modelId === model.id;
    if (!sameId) manualImageChoice.current = false;
    setModelForm(previous => {
      if (previous.connectionId !== currentConnectionId) return previous;
      const next = applyDiscovered(previous, model, sameId && manualImageChoice.current);
      return { ...next, modelId: model.id, name: editingModel === 'new' && !previous.name.trim() ? model.name || model.id : previous.name };
    });
  }

  function syncCurrentModel(result: DiscoveredModelsResult, connectionId: string, session: number) {
    if (session !== modelPickerGeneration.current) return;
    setModelForm(previous => {
      if (previous.connectionId !== connectionId) return previous;
      const matched = result.models.find(model => model.id === previous.modelId);
      return matched ? applyDiscovered(previous, matched, manualImageChoice.current) : previous;
    });
  }

  async function saveConnection(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const editing = editingConnection !== 'new';
      const body = editing && !connectionForm.apiKey.trim() ? { name: connectionForm.name, provider: connectionForm.provider, baseUrl: connectionForm.baseUrl } : connectionForm;
      const editedId = editing ? editingConnection : null;
      await api(editing ? `/connections/${encodeURIComponent(editingConnection!)}` : '/connections', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      const closedModelForm = !!editedId && activeModelEditing.current !== null && activeModelConnection.current === editedId;
      if (closedModelForm) {
        invalidateModelPicker();
        manualImageChoice.current = false;
        setEditingModel(null);
        setModelForm(blankModel);
      }
      setEditingConnection(null); setConnectionForm(blankConnection);
      setMessage(closedModelForm ? '供应商已保存。相关模型编辑已关闭，请重新打开以获取最新能力信息。' : '供应商已保存。');
      await load();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function saveModel(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const editing = editingModel !== 'new';
      await api(editing ? `/models/${encodeURIComponent(editingModel!)}` : '/models', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(modelForm) });
      setEditingModel(null); setModelForm(blankModel); setMessage('模型已保存。'); await load();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function setDefault(model: Model) {
    setBusy(true); setError(''); setMessage('');
    try {
      await api(`/models/${encodeURIComponent(model.id)}`, { method: 'PATCH', body: JSON.stringify({ isDefault: true }) });
      setMessage(`${model.name} 已设为默认模型。`); await load();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function testModel(model: Model) {
    setTestingId(model.id); setError(''); setMessage('');
    try { const result = await api<{ ok: boolean; message: string }>(`/models/${encodeURIComponent(model.id)}/test`, { method: 'POST' }); setMessage(result.message || `${model.name} 连接成功。`); }
    catch (cause) { setError(`${model.name} 测试失败：${errorMessage(cause)}`); }
    finally { setTestingId(''); }
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await api(`/${deleteTarget.kind === 'connection' ? 'connections' : 'models'}/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' });
      setDeleteTarget(null); setMessage('已删除。'); await load();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function exportData() {
    setBusy(true); setError('');
    try {
      const data = await api<unknown>('/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `sayseed-export-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  return <div className="page-container settings-page"><header className="page-header"><div><span className="eyebrow">YOUR SPACE</span><h1>设置<span className="heading-leaf">✳</span></h1><p>选择合适的模型，管理你的私人学习空间。</p></div></header>{loading && <div className="notice">正在加载设置…</div>}{error && <div className="notice error" role="alert">{error}<button className="text-button" onClick={() => void load()}>重新加载</button></div>}{message && <div className="notice success" role="status">{message}</div>}
    <section className="settings-section"><div className="section-header"><div><span className="eyebrow">01 / PROVIDERS</span><h2>供应商</h2><p>密钥保存在服务器上。编辑时留空代表继续使用已保存的密钥。</p></div><button className="button secondary" onClick={() => editConnection()}>＋ 添加供应商</button></div>{connections.length === 0 && !loading ? <div className="setting-empty">还没有供应商。先添加供应商，再添加具体模型。</div> : <div className="connection-list">{connections.map(connection => <div className="connection-row" key={connection.id}><div className="provider-icon">{connection.provider === 'google' ? 'G' : connection.provider === 'anthropic' ? 'A' : '✳'}</div><div className="connection-main"><strong>{connection.name}</strong><span>{providerNames[connection.provider]}{connection.baseUrl && ` · ${connection.baseUrl}`}</span></div><span className={connection.hasApiKey ? 'status-chip ready' : 'status-chip'}>{connection.hasApiKey ? '密钥已保存' : '未设置密钥'}</span><button className="text-button" onClick={() => editConnection(connection)}>编辑</button><button className="icon-button subtle-danger" aria-label={`删除 ${connection.name}`} onClick={() => setDeleteTarget({ kind: 'connection', id: connection.id, name: connection.name })}>×</button></div>)}</div>}{editingConnection && <form className="inline-form" onSubmit={saveConnection}><h3>{editingConnection === 'new' ? '添加供应商' : '编辑供应商'}</h3><div className="form-grid"><label>名称<input required maxLength={100} value={connectionForm.name} onChange={e => setConnectionForm(previous => ({ ...previous, name: e.target.value }))} placeholder="例如：我的 OpenAI"/></label><label>服务类型<select value={connectionForm.provider} onChange={e => setConnectionForm(previous => ({ ...previous, provider: e.target.value as Provider }))}>{Object.entries(providerNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="full-span">接口地址{connectionForm.provider === 'openai-compatible' ? '（必填）' : '（留空使用官方地址）'}<input value={connectionForm.baseUrl} maxLength={2048} onChange={e => setConnectionForm(previous => ({ ...previous, baseUrl: e.target.value }))} placeholder="https://api.example.com/v1"/></label><label className="full-span">API 密钥<input type="password" autoComplete="off" value={connectionForm.apiKey} maxLength={4000} onChange={e => setConnectionForm(previous => ({ ...previous, apiKey: e.target.value }))} placeholder={editingConnection === 'new' ? '输入 API 密钥' : '留空则保留现有密钥'}/></label></div><div className="form-actions"><button type="button" className="button secondary" onClick={() => setEditingConnection(null)}>取消</button><button type="submit" className="button primary" disabled={busy || !connectionForm.name.trim()}>{busy ? '保存中…' : '保存供应商'}</button></div></form>}</section>
    <section className="settings-section"><div className="section-header"><div><span className="eyebrow">02 / MODELS</span><h2>可用模型</h2><p>默认模型用于网页划词解释。翻译助手也可以切换模型。</p></div><button className="button secondary" onClick={() => editModel()} disabled={!connections.length}>＋ 添加模型</button></div>{models.length === 0 && !loading ? <div className="setting-empty">添加供应商后，可以获取模型列表或手动填写模型 ID。</div> : <div className="model-list">{models.map(model => <div className="model-row" key={model.id}><div className="model-main"><div><strong>{model.name}</strong>{model.isDefault && <span className="default-badge">默认</span>}{model.supportsImages && <span className="image-badge">可看图</span>}</div><span>{connections.find(connection => connection.id === model.connectionId)?.name ?? '未知供应商'} · {model.modelId}</span>{knownLimitText(model.capabilities) && <small className="model-limit-summary">{knownLimitText(model.capabilities)}</small>}{model.reasoningEffort && <small className="model-limit-summary">推理强度：{reasoningEffortLabel(model.reasoningEffort)}</small>}</div><div className="model-actions"><button className="text-button" disabled={!!testingId} onClick={() => void testModel(model)}>{testingId === model.id ? '测试中…' : '测试连接'}</button>{!model.isDefault && <button className="text-button" disabled={busy} onClick={() => void setDefault(model)}>设为默认</button>}<button className="text-button" onClick={() => editModel(model)}>编辑</button><button className="icon-button subtle-danger" aria-label={`删除 ${model.name}`} onClick={() => setDeleteTarget({ kind: 'model', id: model.id, name: model.name })}>×</button></div></div>)}</div>}{editingModel && <form className="inline-form" onSubmit={saveModel}><h3>{editingModel === 'new' ? '添加模型' : '编辑模型'}</h3><div className="form-grid"><label>所属供应商<select value={modelForm.connectionId} required onChange={e => changeModelConnection(e.target.value)}>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></label><label>显示名称<input required maxLength={100} value={modelForm.name} onChange={e => setModelForm(previous => ({ ...previous, name: e.target.value }))} placeholder="例如：日常翻译"/></label><label className="full-span">模型 ID<input required maxLength={200} value={modelForm.modelId} onChange={e => changeModelId(e.target.value)} placeholder="填写服务提供方的模型 ID"/></label></div><ModelPicker key={`${modelPickerSession}:${modelForm.connectionId}`} connectionId={modelForm.connectionId} currentModelId={modelForm.modelId} onSelect={model => selectDiscovered(model, modelPickerSession)} onResults={(result, connectionId) => syncCurrentModel(result, connectionId, modelPickerSession)}/><div className="checkbox-row"><label><input type="checkbox" checked={modelForm.supportsImages} onChange={e => { manualImageChoice.current = true; setModelForm(previous => ({ ...previous, supportsImages: e.target.checked })); }}/>支持图片理解</label><label><input type="checkbox" checked={modelForm.isDefault} onChange={e => setModelForm(previous => ({ ...previous, isDefault: e.target.checked }))}/>设为默认模型</label></div><CapabilitySummary capabilities={modelForm.capabilities} supportsImages={modelForm.supportsImages}/>{modelForm.capabilities.reasoningEffortLevels?.length ? <label className="full-span">推理强度<select value={modelForm.reasoningEffort ?? ''} onChange={event => setModelForm(previous => ({ ...previous, reasoningEffort: event.target.value ? event.target.value as ReasoningEffort : null }))}><option value="">跟随服务商{modelForm.capabilities.defaultReasoningEffort ? `（当前默认：${reasoningEffortLabel(modelForm.capabilities.defaultReasoningEffort)}）` : ''}</option>{modelForm.capabilities.reasoningEffortLevels.map(level => <option key={level} value={level}>{reasoningEffortLabel(level)}</option>)}</select></label> : <p className="model-picker-status">模型列表未提供推理强度档位，将跟随服务商设置。</p>}<div className="form-actions"><button type="button" className="button secondary" onClick={() => { invalidateModelPicker(); setEditingModel(null); setModelForm(blankModel); }}>取消</button><button type="submit" className="button primary" disabled={busy || !modelForm.connectionId || !modelForm.name.trim() || !modelForm.modelId.trim()}>{busy ? '保存中…' : '保存模型'}</button></div></form>}</section>
    <section className="settings-section"><div className="section-header"><div><span className="eyebrow">03 / SYSTEM PROMPTS</span><h2>提示词</h2><p>配置翻译与表达解释的系统提示词，预览完整内容或恢复历史正文。</p></div><Link className="button secondary" href="/settings/prompts">管理提示词 →</Link></div></section>
    <section className="settings-section"><div className="section-header"><div><span className="eyebrow">04 / YOUR DATA</span><h2>数据与扩展</h2><p>你的收藏和复习记录保存在这台服务器上。</p></div></div><div className="settings-info-grid"><div className="info-card"><span className="info-icon">↓</span><h3>导出学习数据</h3><p>下载收藏、卡片和复习记录的 JSON 文件。服务器数据库文件也应定期备份。</p><button className="button secondary" disabled={busy} onClick={() => void exportData()}>{busy ? '准备中…' : '下载 JSON 备份'}</button></div><div className="info-card"><span className="info-icon">↗</span><h3>连接浏览器扩展</h3><p>安装 Sayseed Chrome 扩展后，在扩展中填入当前网站地址和你的登录密码，完成配对。网页划词可在扩展菜单中开启或关闭。</p><span className="site-origin">{typeof window !== 'undefined' ? window.location.origin : '当前网站地址'}</span></div></div></section>
    {deleteTarget && <div className="modal-backdrop" role="alertdialog" aria-modal="true" aria-label="确认删除"><div className="confirm-box"><h3>删除{deleteTarget.kind === 'connection' ? '供应商' : '模型'}“{deleteTarget.name}”？</h3><p>{deleteTarget.kind === 'connection' ? '此供应商下的所有模型也会被删除。已有收藏和复习记录会保留。' : '已有收藏和复习记录会保留。'}</p><div className="confirm-actions"><button className="button secondary" disabled={busy} onClick={() => setDeleteTarget(null)}>取消</button><button className="button danger-button" disabled={busy} onClick={() => void remove()}>{busy ? '删除中…' : '确认删除'}</button></div></div></div>}
  </div>;
}

export default function SettingsPage() { return <ProtectedApp><SettingsContent/></ProtectedApp>; }
