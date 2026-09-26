import { promptKindSchema, promptSaveSchema } from '@sayseed/shared';
import { guard, input, json, route } from '../../../../server/http';
import { getPromptSetting, savePromptSetting } from '../../../../server/prompt-settings';
export const runtime = 'nodejs';
type Params = { params: Promise<{ kind: string }> };
export const GET = route(async (request, { params }: Params) => {
  guard(request);
  return json({ prompt: getPromptSetting(promptKindSchema.parse((await params).kind)) });
});
export const PATCH = route(async (request, { params }: Params) => {
  guard(request);
  return json({ prompt: savePromptSetting(promptKindSchema.parse((await params).kind), await input(request, promptSaveSchema)) });
});
export { options as OPTIONS } from '../../../../server/http';
