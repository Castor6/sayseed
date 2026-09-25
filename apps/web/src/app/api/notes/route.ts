import { noteInputSchema } from '@sayseed/shared';
import { guard, input, json, route } from '../../../server/http';
import { listNotes, saveNote } from '../../../server/study';
export const runtime = 'nodejs';
export const GET = route(request => { guard(request); return json({ notes: listNotes(new URL(request.url).searchParams.get('q') || '') }); });
export const POST = route(async request => { guard(request); return json(saveNote(await input(request, noteInputSchema)), 201); });
export { options as OPTIONS } from '../../../server/http';
