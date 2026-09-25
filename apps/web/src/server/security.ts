import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sqlite } from './db';

const COOKIE = 'sayseed_session';
export const SESSION_LIFETIME_MS = 30 * 86400000;
export const SESSION_RENEW_AFTER_MS = 86400000;
type SessionPayload = { exp: number; iat: number; nonce: string };
let secretCache: Buffer | undefined;
let failedLogins: number[] = [];
export function allowLoginAttempt() {
  const now = Date.now();
  failedLogins = failedLogins.filter(time => now - time < 5 * 60_000);
  return failedLogins.length < 10;
}
export function recordFailedLogin() { failedLogins.push(Date.now()); }
export function clearFailedLogins() { failedLogins = []; }
function secret(): Buffer {
  if (secretCache) return secretCache;
  if (process.env.SAYSEED_SECRET) return secretCache = scryptSync(process.env.SAYSEED_SECRET, 'sayseed-v1', 32);
  const dir = process.env.SAYSEED_DATA_DIR || join(process.cwd(), 'data');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, '.secret');
  if (!existsSync(path)) {
    try { writeFileSync(path, randomBytes(32), { mode: 0o600, flag: 'wx' }); }
    catch (error) { if (!existsSync(path)) throw error; }
  }
  return secretCache = readFileSync(path);
}
export function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(v => v.toString('base64url')).join('.');
}
export function decrypt(value: string): string {
  if (!value) return '';
  const [iv, tag, data] = value.split('.');
  const decipher = createDecipheriv('aes-256-gcm', secret(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
export function configured() { return Boolean(process.env.SAYSEED_PASSWORD); }
export function verifyPassword(value: string) {
  const expected = process.env.SAYSEED_PASSWORD;
  if (!expected) return false;
  const a = scryptSync(value, 'sayseed-password-v1', 32);
  const b = scryptSync(expected, 'sayseed-password-v1', 32);
  return timingSafeEqual(a, b);
}
export function issueToken(now = Date.now(), nonce = randomBytes(12).toString('hex')): string {
  const payload = Buffer.from(JSON.stringify({ exp: now + SESSION_LIFETIME_MS, iat: now, nonce })).toString('base64url');
  const signature = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function readSession(token: string, now = Date.now()): SessionPayload | undefined {
  try {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) return;
    const correct = createHmac('sha256', secret()).update(payload).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (supplied.length !== correct.length || !timingSafeEqual(supplied, correct)) return;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
    // Existing sessions predate iat; their original issue time follows from exp.
    const iat = parsed.iat ?? parsed.exp - SESSION_LIFETIME_MS;
    if (!Number.isFinite(parsed.exp) || parsed.exp <= now || !Number.isFinite(iat) || iat > now ||
      parsed.exp - iat !== SESSION_LIFETIME_MS || typeof parsed.nonce !== 'string' || !parsed.nonce) return;
    if (sqlite().prepare('SELECT 1 FROM revoked_sessions WHERE nonce=? AND expires_at>?').get(parsed.nonce, now)) return;
    return { exp: parsed.exp, iat, nonce: parsed.nonce };
  } catch { return; }
}
export function verifyToken(token: string): boolean { return !!readSession(token); }
export function requestToken(request: Request): string | undefined {
  const bearer = request.headers.get('authorization');
  if (bearer !== null) return /^Bearer\s+/i.test(bearer) ? bearer.replace(/^Bearer\s+/i, '') : undefined;
  return request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
}
export function renewSession(request: Request, now = Date.now()): string | undefined {
  if (!configured()) return;
  const token = requestToken(request);
  const session = token && readSession(token, now);
  if (session && now - session.iat >= SESSION_RENEW_AFTER_MS) return issueToken(now, session.nonce);
}
export function revokeSession(request: Request, now = Date.now()): void {
  const token = requestToken(request);
  const session = token && readSession(token, now);
  if (!session) return;
  const database = sqlite();
  database.transaction(() => {
    database.prepare('DELETE FROM revoked_sessions WHERE expires_at<=?').run(now);
    // Cover every renewal already issued with this identity, not just the incoming token.
    database.prepare('INSERT INTO revoked_sessions (nonce,expires_at) VALUES (?,?) ON CONFLICT(nonce) DO UPDATE SET expires_at=MAX(expires_at,excluded.expires_at)').run(session.nonce, now + SESSION_LIFETIME_MS);
  })();
}
export function authorized(request: Request): boolean {
  if (!configured()) return false;
  const token = requestToken(request);
  return token ? verifyToken(token) : false;
}
export function sessionCookie(token: string, clear = false) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}Max-Age=${clear ? 0 : 2592000}`;
}
export function resetSecretForTests() { secretCache = undefined; }
