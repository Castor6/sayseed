import { guard, input, json, route } from '../../../server/http';
import { modelInputSchema } from '@sayseed/shared';
import { addModel, listModels } from '../../../server/catalog';
export const runtime = 'nodejs';
export const GET = route(request => { guard(request); return json({ models: listModels() }); });
export const POST = route(async request => { guard(request); return json({ model: addModel(await input(request, modelInputSchema)) }, 201); });
export { options as OPTIONS } from '../../../server/http';
