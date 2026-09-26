import { promptDraftSchema, promptKindSchema } from '@sayseed/shared';
import { guard, input, json, route } from '../../../../../server/http';
import { previewPrompt } from '../../../../../server/prompt-settings';
export const runtime = 'nodejs';
type Params = { params: Promise<{ kind: string }> };
export const POST = route(async (request, { params }: Params) => {
  guard(request);
  return json({ system: previewPrompt(promptKindSchema.parse((await params).kind), await input(request, promptDraftSchema)) });
});
export { options as OPTIONS } from '../../../../../server/http';
