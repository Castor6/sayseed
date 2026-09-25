import { authorized, configured } from '../../../server/security';
import { json, route } from '../../../server/http';
export const runtime = 'nodejs';
export const GET = route(request => json({ authenticated: authorized(request), configured: configured() }));
