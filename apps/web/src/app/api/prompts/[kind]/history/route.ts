import { promptKindSchema } from '@sayseed/shared';
import { guard, json, route } from '../../../../../server/http';
import { getPromptHistory } from '../../../../../server/prompt-settings';
export const runtime = 'nodejs';
type Params = { params: Promise<{ kind: string }> };
export const GET = route(async (request, { params }: Params) => {
  guard(request);
  const query = new URL(request.url).searchParams;
  return json(getPromptHistory(promptKindSchema.parse((await params).kind), {
    limit: query.get('limit') ?? undefined, offset: query.get('offset') ?? undefined,
  }));
});
export { options as OPTIONS } from '../../../../../server/http';
