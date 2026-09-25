import { explainSchema } from '@sayseed/shared';
import { guard, input, json, route } from '../../../server/http';
import { explain } from '../../../server/ai';
export const runtime = 'nodejs';
export const POST = route(async request => { guard(request); return json({ explanation: await explain(await input(request, explainSchema)) }); });
export { options as OPTIONS } from '../../../server/http';
