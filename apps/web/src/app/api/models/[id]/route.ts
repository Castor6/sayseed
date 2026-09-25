import { guard, input, json, route } from '../../../../server/http';
import { modelPatchSchema } from '@sayseed/shared';
import { editModel, removeModel } from '../../../../server/catalog';
export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };
export const PATCH = route(async (request, { params }: Params) => { guard(request); return json({ model: editModel((await params).id, await input(request, modelPatchSchema)) }); });
export const DELETE = route(async (request, { params }: Params) => { guard(request); removeModel((await params).id); return json({ ok: true }); });
export { options as OPTIONS } from '../../../../server/http';
