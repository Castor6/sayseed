import { noteInputSchema } from '@sayseed/shared';
import { z } from 'zod';
import { guard, input, json, route } from '../../../../server/http';
import { deleteNote, updateNote } from '../../../../server/study';
export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };
export const PATCH = route(async (request, { params }: Params) => { guard(request); return json({ note: updateNote((await params).id, await input(request, noteInputSchema.partial().extend({ suspended: z.boolean().optional() }))) }); });
export const DELETE = route(async (request, { params }: Params) => { guard(request); deleteNote((await params).id); return json({ ok: true }); });
export { options as OPTIONS } from '../../../../server/http';
