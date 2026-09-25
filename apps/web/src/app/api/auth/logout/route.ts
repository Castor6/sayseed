import { guard, json, route } from '../../../../server/http';
import { revokeSession, sessionCookie } from '../../../../server/security';
export const runtime = 'nodejs';
export const POST = route(request => { guard(request); revokeSession(request); return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', true) }); });
export { options as OPTIONS } from '../../../../server/http';
