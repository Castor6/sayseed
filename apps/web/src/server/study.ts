import { createHash, randomUUID } from 'node:crypto';
import { createEmptyCard, fsrs, Rating, type Card } from 'ts-fsrs';
import { safeSourceUrl, type Note, type NoteInput, type ReviewItem } from '@sayseed/shared';
import { sqlite } from './db';
import { ApiError } from './http';

const scheduler = fsrs();
type Row = Record<string, any>;
function noteFromRow(row: Row): Note {
  return {
    id: row.id, expression: row.expression, sentence: row.sentence, meaning: row.meaning,
    sentenceTranslation: row.sentence_translation, usage: row.usage, context: row.context,
    sourceKind: row.source_kind, sourceUrl: row.source_url, sourceTitle: row.source_title,
    draftZh: row.draft_zh, suspended: Boolean(row.suspended), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function fingerprint(input: Pick<NoteInput, 'expression' | 'sentence' | 'sourceKind' | 'sourceUrl'>) {
  const parts = [input.expression.trim().toLocaleLowerCase(), input.sentence.trim(), input.sourceKind, input.sourceUrl];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
export function listNotes(q = ''): Note[] {
  const rows = sqlite().prepare('SELECT * FROM notes WHERE expression LIKE ? OR sentence LIKE ? OR meaning LIKE ? ORDER BY created_at DESC').all(...Array(3).fill(`%${q}%`)) as Row[];
  return rows.map(noteFromRow);
}
export function saveNote(input: NoteInput): { note: Note; duplicate: boolean } {
  if (input.sourceUrl && !safeSourceUrl(input.sourceUrl)) throw new ApiError(400, '来源链接必须是 HTTP 或 HTTPS');
  const database = sqlite();
  const fp = fingerprint(input);
  return database.transaction(() => {
    const existing = database.prepare('SELECT * FROM notes WHERE fingerprint = ?').get(fp) as Row | undefined;
    if (existing) return { note: noteFromRow(existing), duplicate: true };
    const id = randomUUID(), cardId = randomUUID(), now = new Date();
    database.prepare(`INSERT INTO notes (id,expression,sentence,meaning,sentence_translation,usage,context,source_kind,source_url,source_title,draft_zh,suspended,created_at,updated_at,fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`).run(
      id, input.expression, input.sentence, input.meaning, input.sentenceTranslation, input.usage, input.context,
      input.sourceKind, input.sourceUrl, input.sourceTitle, input.draftZh, now.toISOString(), now.toISOString(), fp,
    );
    const card = createEmptyCard(now);
    database.prepare('INSERT INTO cards (id,note_id,revision,state,due) VALUES (?,?,?,?,?)').run(cardId, id, 0, JSON.stringify(card), card.due.toISOString());
    return { note: noteFromRow(database.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Row), duplicate: false };
  })();
}
export function updateNote(id: string, patch: Partial<NoteInput> & { suspended?: boolean }): Note {
  if (patch.sourceUrl && !safeSourceUrl(patch.sourceUrl)) throw new ApiError(400, '来源链接必须是 HTTP 或 HTTPS');
  const database = sqlite();
  return database.transaction(() => {
    const existing = database.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Row | undefined;
    if (!existing) throw new ApiError(404, '收藏不存在');
    const merged = { ...noteFromRow(existing), ...patch };
    const fp = fingerprint(merged);
    const colliding = database.prepare('SELECT id FROM notes WHERE fingerprint = ? AND id <> ?').get(fp, id);
    if (colliding) throw new ApiError(409, '这条表达和句子已收藏');
    database.prepare(`UPDATE notes SET expression=?,sentence=?,meaning=?,sentence_translation=?,usage=?,context=?,source_kind=?,source_url=?,source_title=?,draft_zh=?,suspended=?,updated_at=?,fingerprint=? WHERE id=?`).run(
      merged.expression, merged.sentence, merged.meaning, merged.sentenceTranslation, merged.usage, merged.context,
      merged.sourceKind, merged.sourceUrl, merged.sourceTitle, merged.draftZh, Number(merged.suspended), new Date().toISOString(), fp, id,
    );
    return noteFromRow(database.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Row);
  })();
}
export function deleteNote(id: string) {
  const result = sqlite().prepare('DELETE FROM notes WHERE id = ?').run(id);
  if (!result.changes) throw new ApiError(404, '收藏不存在');
}
function restoreCard(value: string): Card {
  const card = JSON.parse(value) as Card;
  card.due = new Date(card.due);
  if (card.last_review) card.last_review = new Date(card.last_review);
  return card;
}
export function reviewQueue(now = new Date()): { items: ReviewItem[]; dueCount: number; newCount: number } {
  const rows = sqlite().prepare(`SELECT c.*, n.id AS note_marker FROM cards c JOIN notes n ON n.id=c.note_id WHERE n.suspended=0 AND c.due<=? ORDER BY CASE WHEN json_extract(c.state,'$.state')=0 THEN 1 ELSE 0 END, c.due, n.created_at`).all(now.toISOString()) as Row[];
  const items = rows.map(row => {
    const note = sqlite().prepare('SELECT * FROM notes WHERE id = ?').get(row.note_id) as Row;
    const card = restoreCard(row.state);
    const next = scheduler.repeat(card, now);
    return { note: noteFromRow(note), cardId: row.id, revision: row.revision, due: row.due,
      state: card.state, intervals: {
        '1': next[Rating.Again].card.due.toISOString(), '2': next[Rating.Hard].card.due.toISOString(),
        '3': next[Rating.Good].card.due.toISOString(), '4': next[Rating.Easy].card.due.toISOString(),
      },
    } satisfies ReviewItem;
  });
  return { items, dueCount: items.filter(item => item.state !== 0).length, newCount: items.filter(item => item.state === 0).length };
}
export function submitReview(input: { cardId: string; revision: number; rating: number; idempotencyKey: string }, now = new Date()) {
  const database = sqlite();
  return database.transaction(() => {
    const duplicate = database.prepare('SELECT * FROM reviews WHERE idempotency_key = ?').get(input.idempotencyKey) as Row | undefined;
    if (duplicate) {
      if (duplicate.card_id !== input.cardId || duplicate.revision !== input.revision || duplicate.rating !== input.rating) throw new ApiError(409, '请求标识已用于其他评分');
      return { ok: true, due: duplicate.due };
    }
    const row = database.prepare('SELECT c.*, n.suspended FROM cards c JOIN notes n ON n.id=c.note_id WHERE c.id=?').get(input.cardId) as Row | undefined;
    if (!row) throw new ApiError(404, '卡片不存在');
    if (row.suspended) throw new ApiError(409, '卡片已暂停');
    if (row.revision !== input.revision) throw new ApiError(409, '卡片已更新，请刷新复习列表');
    if (row.due > now.toISOString()) throw new ApiError(409, '卡片尚未到复习时间');
    const rating = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy][input.rating - 1] as Rating.Again | Rating.Hard | Rating.Good | Rating.Easy;
    const result = scheduler.repeat(restoreCard(row.state), now)[rating];
    if (!result) throw new ApiError(400, '无效评分');
    const due = result.card.due.toISOString();
    database.prepare('UPDATE cards SET revision=revision+1,state=?,due=? WHERE id=? AND revision=?').run(JSON.stringify(result.card), due, input.cardId, input.revision);
    database.prepare('INSERT INTO reviews (id,card_id,revision,rating,idempotency_key,due,reviewed_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), input.cardId, input.revision, input.rating, input.idempotencyKey, due, now.toISOString());
    return { ok: true, due };
  })();
}
export function exportData() {
  const database = sqlite();
  return { version: 1, exportedAt: new Date().toISOString(), notes: database.prepare('SELECT * FROM notes').all(), cards: database.prepare('SELECT * FROM cards').all(), reviews: database.prepare('SELECT * FROM reviews').all() };
}
