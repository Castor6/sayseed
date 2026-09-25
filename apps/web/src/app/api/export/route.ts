import { guard, json, route } from '../../../server/http';
import { exportData } from '../../../server/study';
export const runtime = 'nodejs';
export const GET = route(request => { guard(request); return json(exportData()); });
export { options as OPTIONS } from '../../../server/http';
