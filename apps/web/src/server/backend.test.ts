import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError, sameOriginMutation } from './http';
import { resetDatabaseForTests, sqlite } from './db';
import { authorized, decrypt, encrypt, issueToken, resetSecretForTests, verifyPassword } from './security';
import { deleteNote, listNotes, reviewQueue, saveNote, submitReview, updateNote } from './study';
import { POST as login } from '../app/api/auth/login/route';

const dataDir = mkdtempSync(join(tmpdir(), 'sayseed-backend-'));
before(() => { process.env.SAYSEED_DATA_DIR = dataDir; process.env.SAYSEED_PASSWORD = 'test-password'; resetSecretForTests(); resetDatabaseForTests(); });
after(() => { resetDatabaseForTests(); resetSecretForTests(); rmSync(dataDir, { recursive: true, force: true }); });

const note = { expression: 'buy', sentence: "I don't quite buy that argument.", meaning: '相信', sentenceTranslation: '我还不太信服。', usage: 'don’t quite buy 表示有所保留', context: '', sourceKind: 'webpage' as const, sourceUrl: 'https://example.com/a', sourceTitle: 'Page', draftZh: '' };

test('auth token and AES-GCM secret are distinct from plaintext', () => {
  assert.equal(verifyPassword('wrong'), false);
  assert.equal(verifyPassword('test-password'), true);
  const encrypted = encrypt('fixture-only-key');
  assert.ok(!encrypted.includes('fixture-only-key'));
  assert.equal(decrypt(encrypted), 'fixture-only-key');
  assert.equal(authorized(new Request('http://localhost/api/notes', { headers: { Authorization: `Bearer ${issueToken()}` } })), true);
  assert.equal(authorized(new Request('http://localhost/api/notes')), false);
});

test('browser cross-origin cookie writes reject, extension login accepts chrome extension origin', async () => {
  assert.throws(() => sameOriginMutation(new Request('http://localhost/api/notes', { method: 'POST', headers: { Origin: 'https://attacker.example' } })), ApiError);
  const request = new Request('http://localhost/api/auth/login', { method: 'POST', headers: { Origin: `chrome-extension://${'a'.repeat(32)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-password' }) });
  const response = await login(request);
  assert.equal(response.status, 200);
  assert.ok((await response.json()).token);
});

test('duplicate note produces one FSRS card, review retry is idempotent and stale revision conflicts', () => {
  const first = saveNote(note);
  const second = saveNote(note);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.note.id, second.note.id);
  assert.equal((sqlite().prepare('SELECT count(*) AS n FROM cards').get() as { n: number }).n, 1);
  const queue = reviewQueue();
  assert.equal(queue.items.length, 1);
  assert.equal(queue.newCount, 1);
  for (const rating of [1, 2, 3, 4] as const) assert.ok(queue.items[0].intervals[String(rating) as '1' | '2' | '3' | '4']);
  const request = { cardId: queue.items[0].cardId, revision: queue.items[0].revision, rating: 3, idempotencyKey: 'one-review-attempt' };
  const now = new Date();
  const result = submitReview(request, now);
  assert.equal(submitReview(request, now).due, result.due);
  assert.equal((sqlite().prepare('SELECT count(*) AS n FROM reviews').get() as { n: number }).n, 1);
  assert.throws(() => submitReview({ ...request, rating: 4 }, now), /请求标识/);
  assert.throws(() => submitReview({ ...request, idempotencyKey: 'another-attempt' }, now), /卡片已更新/);
  updateNote(first.note.id, { suspended: true });
  assert.equal(reviewQueue().items.length, 0);
  deleteNote(first.note.id);
  assert.equal(listNotes().length, 0);
  assert.equal((sqlite().prepare('SELECT count(*) AS n FROM reviews').get() as { n: number }).n, 0);
});
