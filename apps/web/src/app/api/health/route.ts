import { json, route } from '../../../server/http';
export const runtime = 'nodejs';
export const GET = route(() => json({ ok: true }));
