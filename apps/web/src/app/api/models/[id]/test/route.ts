import { guard, json, route } from '../../../../../server/http';
import { testModel } from '../../../../../server/ai';
export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };
export const POST = route(async (request, { params }: Params) => { guard(request); return json(await testModel((await params).id)); });
export { options as OPTIONS } from '../../../../../server/http';
