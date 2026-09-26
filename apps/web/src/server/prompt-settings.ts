import { promptDraftSchema, promptKindSchema, promptSaveSchema, type PromptDraft, type PromptHistoryResult, type PromptKind, type PromptRevision, type PromptSaveInput, type PromptSetting, type PromptVersionInfo } from '@sayseed/shared';
import { z } from 'zod';
import { sqlite } from './db';
import { ApiError } from './http';
import { assembleSystemPrompt, promptDefinition } from './prompts';

const columns = 'kind, mode, revision, body, default_version AS defaultVersion, protocol_version AS protocolVersion, updated_at AS updatedAt';
function initialRevision(kind: PromptKind): PromptRevision {
  const definition = promptDefinition(kind);
  return { kind, mode: 'default', revision: 0, body: definition.body, defaultVersion: definition.defaultVersion,
    protocolVersion: definition.protocolVersion, updatedAt: null };
}
export function getPromptSetting(kind: PromptKind): PromptSetting {
  promptKindSchema.parse(kind);
  const stored = sqlite().prepare(`SELECT ${columns} FROM prompt_settings WHERE kind=?`).get(kind) as PromptRevision | undefined;
  const current = stored ?? initialRevision(kind);
  const definition = promptDefinition(kind);
  const body = current.mode === 'default' ? definition.body : current.body;
  return { ...current, body, defaultVersion: definition.defaultVersion, protocolVersion: definition.protocolVersion,
    defaultBody: definition.body,
    fixedRules: definition.prefix ? `【正文前】\n${definition.prefix}\n\n【正文后】\n${definition.suffix}` : definition.suffix,
    system: assembleSystemPrompt(kind, body) };
}
export function listPromptSettings(): PromptSetting[] { return promptKindSchema.options.map(getPromptSetting); }
export function previewPrompt(kind: PromptKind, input: PromptDraft): string {
  promptKindSchema.parse(kind);
  const draft = promptDraftSchema.parse(input);
  return assembleSystemPrompt(kind, draft.mode === 'default' ? promptDefinition(kind).body : draft.body);
}
export function getEffectivePrompt(kind: PromptKind): { system: string; prompt: PromptVersionInfo } {
  const { system, mode, revision, defaultVersion, protocolVersion } = getPromptSetting(kind);
  return { system, prompt: { kind, mode, revision, defaultVersion, protocolVersion } };
}
export function savePromptSetting(kind: PromptKind, input: PromptSaveInput): PromptSetting {
  promptKindSchema.parse(kind);
  const draft = promptSaveSchema.parse(input);
  const database = sqlite();
  return database.transaction(() => {
    const current = getPromptSetting(kind);
    if (draft.revision !== current.revision || draft.defaultVersion !== current.defaultVersion || draft.protocolVersion !== current.protocolVersion) {
      throw new ApiError(409, '提示词已被修改或应用已升级，请重新读取后再保存');
    }
    const insertHistory = database.prepare(`INSERT INTO prompt_revisions (kind, mode, revision, body, default_version, protocol_version, updated_at) VALUES (@kind, @mode, @revision, @body, @defaultVersion, @protocolVersion, @updatedAt)`);
    if (current.revision === 0) insertHistory.run(initialRevision(kind));
    const next: PromptRevision = { kind, mode: draft.mode, revision: current.revision + 1,
      body: draft.mode === 'default' ? current.defaultBody : draft.body,
      defaultVersion: current.defaultVersion, protocolVersion: current.protocolVersion, updatedAt: new Date().toISOString() };
    database.prepare(`INSERT INTO prompt_settings (kind, mode, revision, body, default_version, protocol_version, updated_at)
      VALUES (@kind, @mode, @revision, @body, @defaultVersion, @protocolVersion, @updatedAt)
      ON CONFLICT(kind) DO UPDATE SET mode=excluded.mode, revision=excluded.revision, body=excluded.body,
      default_version=excluded.default_version, protocol_version=excluded.protocol_version, updated_at=excluded.updated_at`).run(next);
    insertHistory.run(next);
    return getPromptSetting(kind);
  }).immediate();
}
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
});
export function getPromptHistory(kind: PromptKind, pagination: { limit?: unknown; offset?: unknown } = {}): PromptHistoryResult {
  promptKindSchema.parse(kind);
  const { limit, offset } = paginationSchema.parse(pagination);
  const database = sqlite();
  const { total } = database.prepare('SELECT COUNT(*) AS total FROM prompt_revisions WHERE kind=?').get(kind) as { total: number };
  // A pristine installation has a virtual default revision without writing on reads.
  if (!total) return { items: offset === 0 ? [initialRevision(kind)] : [], total: 1, limit, offset };
  const items = database.prepare(`SELECT ${columns} FROM prompt_revisions WHERE kind=? ORDER BY revision DESC LIMIT ? OFFSET ?`).all(kind, limit, offset) as PromptRevision[];
  return { items, total, limit, offset };
}
