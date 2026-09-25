import { guard, json, options, route } from '../../../server/http';
import { listUsage } from '../../../server/usage';

export const runtime = 'nodejs';
export const GET = route((request: Request) => {
  guard(request);
  return json(listUsage(new URL(request.url).searchParams));
});
export { options as OPTIONS };
