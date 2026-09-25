import { translateSchema } from '@sayseed/shared';
import { guard, input, route } from '../../../server/http';
import { translate } from '../../../server/ai';
export const runtime = 'nodejs';
export const POST = route(async request => {
  guard(request);
  const stream = await translate(await input(request, translateSchema), request.signal);
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
});
export { options as OPTIONS } from '../../../server/http';
