import { guard, input, json, route } from '../../../server/http';
import { connectionInputSchema } from '@sayseed/shared';
import { addConnection, listConnections } from '../../../server/catalog';
export const runtime = 'nodejs';
export const GET = route(request => { guard(request); return json({ connections: listConnections() }); });
export const POST = route(async request => { guard(request); return json({ connection: addConnection(await input(request, connectionInputSchema)) }, 201); });
export { options as OPTIONS } from '../../../server/http';
