'use client';

import { useEffect, useRef, useState } from 'react';
import type { DiscoveredModel, DiscoveredModelsResult } from '@sayseed/shared';
import { api, errorMessage } from './api';
import { reasoningEffortLabel } from './reasoning-label';

export function ModelPicker({ connectionId, currentModelId, onSelect, onResults }: {
  connectionId: string;
  currentModelId: string;
  onSelect: (model: DiscoveredModel) => void;
  onResults: (result: DiscoveredModelsResult, connectionId: string) => void;
}) {
  const [result, setResult] = useState<DiscoveredModelsResult | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => {
    requestVersion.current++;
    controller.current?.abort();
  }, []);

  async function fetchModels() {
    if (!connectionId) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const version = ++requestVersion.current;
    setLoading(true);
    setError('');
    setResult(null);
    setQuery('');
    try {
      const next = await api<DiscoveredModelsResult>(`/connections/${encodeURIComponent(connectionId)}/available-models`, { signal: abort.signal });
      if (version === requestVersion.current) {
        setResult(next);
        onResults(next, connectionId);
      }
    } catch (cause) {
      if (version === requestVersion.current) setError(errorMessage(cause));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }

  const normalized = query.trim().toLocaleLowerCase();
  const visible = result?.models.filter(model =>
    model.id.toLocaleLowerCase().includes(normalized) || model.name.toLocaleLowerCase().includes(normalized)
  ) ?? [];

  return <div className="model-picker">
    <div className="model-picker-intro"><div><strong>从供应商中选择模型</strong><p>可获取服务方提供的列表，也可以直接在上方填写模型 ID。</p></div><button type="button" className="button secondary" onClick={() => void fetchModels()} disabled={!connectionId || loading}>{loading ? '正在获取…' : result ? '重新获取' : '获取模型列表'}</button></div>
    {loading && <p className="model-picker-status" role="status">正在获取模型列表…</p>}
    {error && <p className="model-picker-error" role="alert">获取失败：{error}</p>}
    {result && <div className="model-picker-results"><label className="model-picker-search">搜索模型名称或 ID<input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索模型" aria-label="搜索模型名称或 ID"/></label><p className="model-picker-status">{result.models.length === 0 ? '此供应商没有返回可选模型，请手动填写模型 ID。' : `共获取 ${result.models.length} 个模型${normalized ? `，找到 ${visible.length} 个` : ''}。`}</p>{result.truncated && <p className="model-picker-warning">列表已截断，未显示的模型仍可手动输入 ID。</p>}{result.models.length > 0 && visible.length === 0 && <p className="model-picker-status">没有匹配的模型。可更换关键词或手动填写 ID。</p>}{visible.length > 0 && <div className="model-picker-list" role="list">{visible.map(model => <div role="listitem" key={model.id}><button type="button" className={currentModelId === model.id ? 'model-picker-option selected' : 'model-picker-option'} onClick={() => onSelect(model)}><span><strong>{model.name || model.id}</strong><small>{model.id}</small>{model.description && <small>{model.description}</small>}{model.capabilities?.reasoningEffortLevels?.length ? <small>推理强度：{model.capabilities.reasoningEffortLevels.map(reasoningEffortLabel).join(' / ')}</small> : null}</span><span aria-hidden="true">{currentModelId === model.id ? '已选择 ✓' : '选择 ↗'}</span></button></div>)}</div>}</div>}
  </div>;
}
