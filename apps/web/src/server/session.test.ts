import { after, afterEach, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, scryptSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetDatabaseForTests } from './db';
import { POST as logout } from '../app/api/auth/logout/route';
import { POST as login } from '../app/api/auth/login/route';
import { guard, json, route } from './http';
import { authorized, issueToken, renewSession, resetSecretForTests, SESSION_LIFETIME_MS, SESSION_RENEW_AFTER_MS, sessionCookie, verifyToken } from './security';

const now = 1_800_000_000_000;
const previousSecret = process.env.SAYSEED_SECRET;
const previousPassword = process.env.SAYSEED_PASSWORD;
const dir = mkdtempSync(join(tmpdir(), 'sayseed-sessions-'));
before(() => { process.env.SAYSEED_DATA_DIR = dir; process.env.SAYSEED_SECRET = 'session-test-secret'; process.env.SAYSEED_PASSWORD = 'test-password'; resetSecretForTests(); resetDatabaseForTests(); });
afterEach(() => mock.restoreAll());
after(() => {
  if (previousSecret === undefined) delete process.env.SAYSEED_SECRET; else process.env.SAYSEED_SECRET = previousSecret;
  if (previousPassword === undefined) delete process.env.SAYSEED_PASSWORD; else process.env.SAYSEED_PASSWORD = previousPassword;
  resetSecretForTests();
  resetDatabaseForTests(); rmSync(dir, { recursive: true, force: true });
});
const payload = (token: string) => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
function request(token: string, options: { cookie?: boolean; active?: boolean; path?: string; method?: string } = {}) {
  return new Request(`http://localhost${options.path || '/api/notes'}`, {
    method: options.method || 'GET', headers: {
      ...(options.cookie ? { Cookie: sessionCookie(token).split(';')[0] } : { Authorization: `Bearer ${token}` }),
      ...(options.active === false ? {} : { 'X-Sayseed-Activity': '1' }),
    },
  });
}
const handle = route(req => { guard(req); return json({ ok: true }); });

test('active sessions renew after 24 hours and keep their identity with a new 30-day expiry', async () => {
  mock.method(Date, 'now', () => now);
  const original = issueToken(now - 20 * 86400000);
  const result = await handle(request(original));
  const token = result.headers.get('X-Sayseed-Session')!;
  assert.ok(token);
  assert.equal(payload(token).nonce, payload(original).nonce);
  assert.equal(payload(token).exp, now + SESSION_LIFETIME_MS);
  assert.equal(verifyToken(token), true);
  assert.equal(result.headers.get('set-cookie'), null);
  assert.match(result.headers.get('access-control-expose-headers')!, /X-Sayseed-Session/);
  assert.equal((await handle(request(token))).headers.get('X-Sayseed-Session'), null);
  assert.equal(renewSession(request(issueToken(now - SESSION_RENEW_AFTER_MS + 1))), undefined);
  assert.ok(renewSession(request(issueToken(now - SESSION_RENEW_AFTER_MS))));
});

test('web renewal sets an HttpOnly cookie without exposing its value to JavaScript', async () => {
  mock.method(Date, 'now', () => now);
  const response = await handle(request(issueToken(now - 2 * 86400000), { cookie: true }));
  assert.match(response.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict;.*Max-Age=2592000/);
  assert.equal(response.headers.get('X-Sayseed-Session'), null);
});

test('idle, failed, login/logout and health requests do not renew sessions', async () => {
  mock.method(Date, 'now', () => now);
  const token = issueToken(now - 2 * 86400000);
  assert.equal((await handle(request(token, { active: false }))).headers.get('X-Sayseed-Session'), null);
  for (const path of ['/api/auth/login', '/api/auth/logout', '/api/health']) {
    assert.equal((await handle(request(token, { path }))).headers.get('X-Sayseed-Session'), null);
  }
  const failed = route(req => { guard(req); return json({ error: 'bad input' }, 400); });
  assert.equal((await failed(request(token))).headers.get('X-Sayseed-Session'), null);
  const logout = route(req => { guard(req); return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', true) }); });
  assert.match((await logout(request(token, { path: '/api/auth/logout' }))).headers.get('set-cookie')!, /Max-Age=0/);
});

test('expired and modified tokens cannot authenticate or be revived', async () => {
  mock.method(Date, 'now', () => now);
  for (const token of [issueToken(now - SESSION_LIFETIME_MS), `${issueToken(now - 2 * 86400000)}.extra`, 'invalid.token']) {
    assert.equal(authorized(request(token)), false);
    assert.equal(renewSession(request(token)), undefined);
    const response = await handle(request(token));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('X-Sayseed-Session'), null);
  }
});

test('unexpired legacy sessions without iat renew without forcing a login', () => {
  mock.method(Date, 'now', () => now);
  const encoded = Buffer.from(JSON.stringify({ exp: now + 86400000, nonce: 'legacy-session' })).toString('base64url');
  const signature = createHmac('sha256', scryptSync('session-test-secret', 'sayseed-v1', 32)).update(encoded).digest('base64url');
  const legacy = `${encoded}.${signature}`;
  assert.equal(verifyToken(legacy), true);
  assert.equal(payload(renewSession(request(legacy))!).nonce, 'legacy-session');
});

test('streaming responses deliver renewal headers without consuming the body', async () => {
  mock.method(Date, 'now', () => now);
  const stream = route(req => { guard(req); return new Response('data: hello\n\n', { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform' } }); });
  const response = await stream(request(issueToken(now - 2 * 86400000)));
  assert.ok(response.headers.get('X-Sayseed-Session'));
  assert.equal(response.headers.get('cache-control'), 'no-cache, no-transform');
  assert.equal(await response.text(), 'data: hello\n\n');
});

test('logout revokes the session identity and prevents a slow response from restoring it', async () => {
  mock.method(Date, 'now', () => now);
  const original = issueToken(now - 2 * 86400000);
  const alreadyRenewed = renewSession(request(original))!;
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const slow = route(async req => { guard(req); await pending; return json({ ok: true }); });
  const result = slow(request(original, { cookie: true }));
  assert.equal((await logout(request(original, { cookie: true, path: '/api/auth/logout', method: 'POST' }))).status, 200);
  finish();
  assert.equal((await result).headers.get('set-cookie'), null);
  assert.equal(verifyToken(original), false);
  assert.equal(verifyToken(alreadyRenewed), false);
  resetDatabaseForTests();
  assert.equal(verifyToken(alreadyRenewed), false);
});

test('successful new web login prevents pending requests from renewing the old login', async () => {
  mock.method(Date, 'now', () => now);
  const old = issueToken(now - 2 * 86400000);
  const response = await login(new Request('http://localhost/api/auth/login', { method: 'POST',
    headers: { Cookie: `sayseed_session=${old}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-password' }) }));
  const next = (await response.json()).token;
  assert.equal(verifyToken(next), true);
  assert.equal(verifyToken(old), false);
  assert.equal(renewSession(request(old)), undefined);
});
