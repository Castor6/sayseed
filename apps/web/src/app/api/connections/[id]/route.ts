import { guard, input, json, route } from '../../../../server/http';
import { connectionPatchSchema } from '@sayseed/shared';
import { editConnection, removeConnection } from '../../../../server/catalog';
export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };
export const PATCH = route(async (request, { params }: Params) => { guard(request); return json({ connection: editConnection((await params).id, await input(request, connectionPatchSchema)) }); });
export const DELETE = route(async (request, { params }: Params) => { guard(request); removeConnection((await params).id); return json({ ok: true }); });
export { options as OPTIONS } from '../../../../server/http';
