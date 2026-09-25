import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const connections = sqliteTable('connections', {
  id: text('id').primaryKey(), name: text('name').notNull(), provider: text('provider').notNull(),
  baseUrl: text('base_url').notNull(), encryptedKey: text('encrypted_key').notNull(),
});
export const models = sqliteTable('models', {
  id: text('id').primaryKey(), connectionId: text('connection_id').notNull(),
  name: text('name').notNull(), modelId: text('model_id').notNull(),
  supportsImages: integer('supports_images').notNull(), isDefault: integer('is_default').notNull(),
  capabilitiesJson: text('capabilities_json'), reasoningEffort: text('reasoning_effort'),
});
export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(), expression: text('expression').notNull(), sentence: text('sentence').notNull(),
  meaning: text('meaning').notNull(), sentenceTranslation: text('sentence_translation').notNull(),
  usage: text('usage').notNull(), context: text('context').notNull(), sourceKind: text('source_kind').notNull(),
  sourceUrl: text('source_url').notNull(), sourceTitle: text('source_title').notNull(), draftZh: text('draft_zh').notNull(),
  suspended: integer('suspended').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
  fingerprint: text('fingerprint').notNull().unique(),
});
export const cards = sqliteTable('cards', {
  id: text('id').primaryKey(), noteId: text('note_id').notNull().unique(), revision: integer('revision').notNull(),
  state: text('state').notNull(), due: text('due').notNull(),
});
export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(), cardId: text('card_id').notNull(), revision: integer('revision').notNull(),
  rating: integer('rating').notNull(), idempotencyKey: text('idempotency_key').notNull().unique(),
  due: text('due').notNull(), reviewedAt: text('reviewed_at').notNull(),
});
export const usageLogs = sqliteTable('usage_logs', {
  id: text('id').primaryKey(), startedAt: text('started_at').notNull(), durationMs: integer('duration_ms').notNull(),
  modelRecordId: text('model_record_id').notNull(), modelName: text('model_name').notNull(),
  connectionName: text('connection_name').notNull(), provider: text('provider').notNull(), modelId: text('model_id').notNull(),
  purpose: text('purpose').notNull(), status: text('status').notNull(), reasoningEffort: text('reasoning_effort'),
  errorCode: text('error_code'), inputTokens: integer('input_tokens'), outputTokens: integer('output_tokens'),
  totalTokens: integer('total_tokens'), reasoningTokens: integer('reasoning_tokens'),
  cacheReadTokens: integer('cache_read_tokens'), cacheWriteTokens: integer('cache_write_tokens'),
  contextJson: text('context_json'),
});

let connection: Database.Database | undefined;
export function sqlite(): Database.Database {
  if (connection) return connection;
  const dir = process.env.SAYSEED_DATA_DIR || join(process.cwd(), 'data');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dir, 'sayseed.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, base_url TEXT NOT NULL, encrypted_key TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS models (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE, name TEXT NOT NULL, model_id TEXT NOT NULL, supports_images INTEGER NOT NULL, is_default INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, expression TEXT NOT NULL, sentence TEXT NOT NULL, meaning TEXT NOT NULL, sentence_translation TEXT NOT NULL, usage TEXT NOT NULL, context TEXT NOT NULL, source_kind TEXT NOT NULL, source_url TEXT NOT NULL, source_title TEXT NOT NULL, draft_zh TEXT NOT NULL, suspended INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, note_id TEXT NOT NULL UNIQUE REFERENCES notes(id) ON DELETE CASCADE, revision INTEGER NOT NULL, state TEXT NOT NULL, due TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, revision INTEGER NOT NULL, rating INTEGER NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, due TEXT NOT NULL, reviewed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS discovered_effort (connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE, model_id TEXT NOT NULL, levels_json TEXT NOT NULL, default_level TEXT, PRIMARY KEY (connection_id, model_id));
    CREATE TABLE IF NOT EXISTS revoked_sessions (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY, started_at TEXT NOT NULL, duration_ms INTEGER NOT NULL,
      model_record_id TEXT NOT NULL, model_name TEXT NOT NULL, connection_name TEXT NOT NULL,
      provider TEXT NOT NULL, model_id TEXT NOT NULL, purpose TEXT NOT NULL, status TEXT NOT NULL,
      reasoning_effort TEXT, error_code TEXT, input_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER,
      reasoning_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, context_json TEXT
    );
    CREATE INDEX IF NOT EXISTS cards_due_idx ON cards(due);
    CREATE INDEX IF NOT EXISTS notes_created_idx ON notes(created_at);
    CREATE INDEX IF NOT EXISTS usage_started_idx ON usage_logs(started_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS usage_purpose_status_started_idx ON usage_logs(purpose, status, started_at DESC);
    CREATE INDEX IF NOT EXISTS usage_model_started_idx ON usage_logs(model_record_id, started_at DESC);
  `);
  // Preserve existing installations while adding optional provider metadata.
  const modelColumns = db.pragma('table_info(models)') as { name: string }[];
  if (!modelColumns.some(column => column.name === 'capabilities_json')) db.exec('ALTER TABLE models ADD COLUMN capabilities_json TEXT');
  if (!modelColumns.some(column => column.name === 'reasoning_effort')) db.exec('ALTER TABLE models ADD COLUMN reasoning_effort TEXT');
  const usageColumns = db.pragma('table_info(usage_logs)') as { name: string }[];
  if (!usageColumns.some(column => column.name === 'context_json')) db.exec('ALTER TABLE usage_logs ADD COLUMN context_json TEXT');
  connection = db;
  return db;
}
export function db() { return drizzle(sqlite(), { schema: { connections, models, notes, cards, reviews, usageLogs } }); }
export function resetDatabaseForTests() { connection?.close(); connection = undefined; }
