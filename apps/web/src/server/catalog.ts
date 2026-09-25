import { randomUUID } from 'node:crypto';
import { connectionInputSchema, connectionPatchSchema, modelInputSchema, modelPatchSchema, modelCapabilitiesSchema, type Connection, type DiscoveredModelsResult, type Model, type ModelCapabilities, type ReasoningEffort } from '@sayseed/shared';
import { db, sqlite, connections } from './db';
import { encrypt } from './security';
import { ApiError } from './http';

type Row = Record<string, any>;
function connection(row: Row): Connection { return { id: row.id, name: row.name, provider: row.provider, baseUrl: row.base_url, hasApiKey: Boolean(row.encrypted_key) }; }
function storedCapabilities(value: unknown): ModelCapabilities | undefined {
  if (typeof value !== 'string') return;
  try {
    const parsed = modelCapabilitiesSchema.safeParse(JSON.parse(value));
    if (parsed.success && Object.keys(parsed.data).length) return parsed.data;
  } catch { /* Invalid optional metadata does not make a saved model unusable. */ }
}
function encodedCapabilities(value: ModelCapabilities | undefined): string | null {
  return value && Object.keys(value).length ? JSON.stringify(value) : null;
}
function trustedEffort(database: ReturnType<typeof sqlite>, connectionId: string, modelId: string) {
  const row = database.prepare('SELECT levels_json, default_level FROM discovered_effort WHERE connection_id=? AND model_id=?').get(connectionId, modelId) as { levels_json: string; default_level: string | null } | undefined;
  if (!row) return { levels: [] as ReasoningEffort[], defaultLevel: undefined as ReasoningEffort | undefined };
  const levels = JSON.parse(row.levels_json) as ReasoningEffort[];
  return { levels, defaultLevel: row.default_level && levels.includes(row.default_level as ReasoningEffort) ? row.default_level as ReasoningEffort : undefined };
}
function withTrustedEffort(value: ModelCapabilities | undefined, trusted: ReturnType<typeof trustedEffort>): ModelCapabilities | undefined {
  const { reasoningEffortLevels: _levels, defaultReasoningEffort: _default, ...rest } = value ?? {};
  const result: ModelCapabilities = { ...rest };
  if (trusted.levels.length) result.reasoningEffortLevels = trusted.levels;
  if (trusted.defaultLevel) result.defaultReasoningEffort = trusted.defaultLevel;
  return Object.keys(result).length ? result : undefined;
}
function checkedEffort(value: ReasoningEffort | null | undefined, trusted: ReturnType<typeof trustedEffort>): ReasoningEffort | null {
  if (value == null) return null;
  if (!trusted.levels.includes(value)) throw new ApiError(400, '该模型列表未确认支持此推理强度，请重新获取模型列表');
  return value;
}
export function modelFromRow(row: Row): Model {
  const capabilities = storedCapabilities(row.capabilities_json);
  return { id: row.id, connectionId: row.connection_id, name: row.name, modelId: row.model_id, supportsImages: Boolean(row.supports_images), isDefault: Boolean(row.is_default), reasoningEffort: row.reasoning_effort ?? null, ...(capabilities ? { capabilities } : {}) };
}
export function recordDiscoveredEffort(connectionId: string, result: DiscoveredModelsResult) {
  const database = sqlite();
  database.transaction(() => {
    if (!result.truncated) database.prepare('DELETE FROM discovered_effort WHERE connection_id=?').run(connectionId);
    const insert = database.prepare('INSERT INTO discovered_effort (connection_id,model_id,levels_json,default_level) VALUES (?,?,?,?) ON CONFLICT(connection_id,model_id) DO UPDATE SET levels_json=excluded.levels_json,default_level=excluded.default_level');
    const remove = database.prepare('DELETE FROM discovered_effort WHERE connection_id=? AND model_id=?');
    for (const item of result.models) {
      const levels = item.capabilities?.reasoningEffortLevels ?? [];
      if (levels.length) insert.run(connectionId, item.id, JSON.stringify(levels), item.capabilities?.defaultReasoningEffort ?? null);
      else remove.run(connectionId, item.id);
    }
    const saved = database.prepare('SELECT * FROM models WHERE connection_id=?').all(connectionId) as Row[];
    for (const row of saved) {
      if (result.truncated && !result.models.some(item => item.id === row.model_id)) continue;
      const trusted = trustedEffort(database, connectionId, row.model_id);
      const capabilities = withTrustedEffort(storedCapabilities(row.capabilities_json), trusted);
      const effort = trusted.levels.includes(row.reasoning_effort as ReasoningEffort) ? row.reasoning_effort : null;
      database.prepare('UPDATE models SET capabilities_json=?,reasoning_effort=? WHERE id=?').run(encodedCapabilities(capabilities), effort, row.id);
    }
  })();
}
export function listConnections() { return db().select().from(connections).all().map(row => ({ id: row.id, name: row.name, provider: row.provider as Connection['provider'], baseUrl: row.baseUrl, hasApiKey: Boolean(row.encryptedKey) })); }
export function addConnection(value: unknown) {
  const parsed = connectionInputSchema.parse(value);
  const id = randomUUID();
  sqlite().prepare('INSERT INTO connections (id,name,provider,base_url,encrypted_key) VALUES (?,?,?,?,?)').run(id, parsed.name, parsed.provider, parsed.baseUrl, parsed.apiKey ? encrypt(parsed.apiKey) : '');
  return connection(sqlite().prepare('SELECT * FROM connections WHERE id=?').get(id) as Row);
}
export function editConnection(id: string, value: unknown) {
  const database = sqlite();
  const old = database.prepare('SELECT * FROM connections WHERE id=?').get(id) as Row | undefined;
  if (!old) throw new ApiError(404, '供应商不存在');
  const patch = connectionPatchSchema.parse(value);
  database.transaction(() => {
    database.prepare('UPDATE connections SET name=?,provider=?,base_url=?,encrypted_key=? WHERE id=?').run(
      patch.name ?? old.name, patch.provider ?? old.provider, patch.baseUrl ?? old.base_url,
      patch.apiKey ? encrypt(patch.apiKey) : old.encrypted_key, id,
    );
    if ((patch.provider !== undefined && patch.provider !== old.provider) || (patch.baseUrl !== undefined && patch.baseUrl !== old.base_url) || patch.apiKey) {
      database.prepare('DELETE FROM discovered_effort WHERE connection_id=?').run(id);
      database.prepare('UPDATE models SET capabilities_json=NULL,supports_images=0,reasoning_effort=NULL WHERE connection_id=?').run(id);
    }
  })();
  return connection(database.prepare('SELECT * FROM connections WHERE id=?').get(id) as Row);
}
export function removeConnection(id: string) {
  const database = sqlite();
  database.transaction(() => {
    const result = database.prepare('DELETE FROM connections WHERE id=?').run(id);
    if (!result.changes) throw new ApiError(404, '供应商不存在');
    if (!database.prepare('SELECT id FROM models WHERE is_default=1').get()) database.prepare('UPDATE models SET is_default=1 WHERE id=(SELECT id FROM models ORDER BY name LIMIT 1)').run();
  })();
}
export function listModels() { return (sqlite().prepare('SELECT * FROM models').all() as Row[]).map(modelFromRow).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)); }
export function addModel(value: unknown) {
  const parsed = modelInputSchema.parse(value), database = sqlite();
  return database.transaction(() => {
    if (!database.prepare('SELECT id FROM connections WHERE id=?').get(parsed.connectionId)) throw new ApiError(400, '供应商不存在');
    const id = randomUUID();
    const trusted = trustedEffort(database, parsed.connectionId, parsed.modelId);
    const capabilities = withTrustedEffort(parsed.capabilities, trusted);
    const reasoningEffort = checkedEffort(parsed.reasoningEffort, trusted);
    const makeDefault = parsed.isDefault || !database.prepare('SELECT id FROM models WHERE is_default=1').get();
    if (makeDefault) database.prepare('UPDATE models SET is_default=0').run();
    database.prepare('INSERT INTO models (id,connection_id,name,model_id,supports_images,is_default,capabilities_json,reasoning_effort) VALUES (?,?,?,?,?,?,?,?)').run(id, parsed.connectionId, parsed.name, parsed.modelId, Number(parsed.supportsImages ?? parsed.capabilities?.supportsImages ?? false), Number(makeDefault), encodedCapabilities(capabilities), reasoningEffort);
    return modelFromRow(database.prepare('SELECT * FROM models WHERE id=?').get(id) as Row);
  })();
}
export function editModel(id: string, value: unknown) {
  const database = sqlite();
  return database.transaction(() => {
    const old = database.prepare('SELECT * FROM models WHERE id=?').get(id) as Row | undefined;
    if (!old) throw new ApiError(404, '模型不存在');
    const patch = modelPatchSchema.parse(value);
    if (patch.connectionId && !database.prepare('SELECT id FROM connections WHERE id=?').get(patch.connectionId)) throw new ApiError(400, '供应商不存在');
    if (patch.isDefault) database.prepare('UPDATE models SET is_default=0').run();
    if (patch.isDefault === false && old.is_default && !database.prepare('SELECT id FROM models WHERE id<>?').get(id)) throw new ApiError(409, '至少保留一个默认模型');
    const identityChanged = (patch.connectionId !== undefined && patch.connectionId !== old.connection_id) || (patch.modelId !== undefined && patch.modelId !== old.model_id);
    const connectionId = patch.connectionId ?? old.connection_id, modelId = patch.modelId ?? old.model_id;
    const trusted = trustedEffort(database, connectionId, modelId);
    const capabilities = withTrustedEffort(patch.capabilities !== undefined ? patch.capabilities : identityChanged ? undefined : storedCapabilities(old.capabilities_json), trusted);
    const reasoningEffort = checkedEffort(patch.reasoningEffort !== undefined ? patch.reasoningEffort : identityChanged ? null : old.reasoning_effort, trusted);
    database.prepare('UPDATE models SET connection_id=?,name=?,model_id=?,supports_images=?,is_default=?,capabilities_json=?,reasoning_effort=? WHERE id=?').run(
      patch.connectionId ?? old.connection_id, patch.name ?? old.name, patch.modelId ?? old.model_id,
      Number(patch.supportsImages ?? (patch.capabilities !== undefined ? patch.capabilities.supportsImages ?? false : identityChanged ? false : Boolean(old.supports_images))), Number(patch.isDefault ?? Boolean(old.is_default)), encodedCapabilities(capabilities), reasoningEffort, id,
    );
    if (patch.isDefault === false && old.is_default) database.prepare('UPDATE models SET is_default=1 WHERE id=(SELECT id FROM models WHERE id<>? ORDER BY name LIMIT 1)').run(id);
    return modelFromRow(database.prepare('SELECT * FROM models WHERE id=?').get(id) as Row);
  })();
}
export function removeModel(id: string) {
  const database = sqlite();
  database.transaction(() => {
    const old = database.prepare('SELECT * FROM models WHERE id=?').get(id) as Row | undefined;
    if (!old) throw new ApiError(404, '模型不存在');
    database.prepare('DELETE FROM models WHERE id=?').run(id);
    if (old.is_default) database.prepare('UPDATE models SET is_default=1 WHERE id=(SELECT id FROM models ORDER BY name LIMIT 1)').run();
  })();
}
