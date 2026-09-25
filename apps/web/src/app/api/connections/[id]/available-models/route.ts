import { guard, json, route } from '../../../../../server/http';
import { discoverConnectionModels } from '../../../../../server/model-discovery';
import { recordDiscoveredEffort } from '../../../../../server/catalog';
import { sqlite } from '../../../../../server/db';
import { ApiError } from '../../../../../server/http';

export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };
export const GET = route(async (request, { params }: Params) => {
  guard(request);
  const id = (await params).id;
  const snapshot = sqlite().prepare('SELECT provider,base_url,encrypted_key FROM connections WHERE id=?').get(id);
  const result = await discoverConnectionModels(id, request.signal);
  const current = sqlite().prepare('SELECT provider,base_url,encrypted_key FROM connections WHERE id=?').get(id);
  if (JSON.stringify(current) !== JSON.stringify(snapshot)) throw new ApiError(409, '连接在获取模型列表期间发生变化，请重新获取');
  recordDiscoveredEffort(id, result);
  return json(result, 200, { 'Cache-Control': 'no-store' });
});
export { options as OPTIONS } from '../../../../../server/http';
