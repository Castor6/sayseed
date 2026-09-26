import { guard, json, route } from '../../../server/http';
import { listPromptSettings } from '../../../server/prompt-settings';
export const runtime = 'nodejs';
export const GET = route(request => { guard(request); return json({ prompts: listPromptSettings() }); });
export { options as OPTIONS } from '../../../server/http';
