import { reviewInputSchema } from '@sayseed/shared';
import { guard, input, json, route } from '../../../server/http';
import { reviewQueue, submitReview } from '../../../server/study';
export const runtime = 'nodejs';
export const GET = route(request => { guard(request); return json(reviewQueue()); });
export const POST = route(async request => { guard(request); return json(submitReview(await input(request, reviewInputSchema))); });
export { options as OPTIONS } from '../../../server/http';
