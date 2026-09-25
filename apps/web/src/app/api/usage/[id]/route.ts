import { guard, json, options, route } from '../../../../server/http';
import { usageDetail } from '../../../../server/usage';

export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };
export const GET = route(async (request: Request, { params }: Params) => {
  guard(request);
  const id = (await params).id;
  if (id.length > 100) return json({ error: '模型使用记录不存在' }, 404);
  return json(usageDetail(id));
});
export { options as OPTIONS };
