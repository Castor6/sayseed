import { ZodError, type ZodType } from 'zod';
import { authorized, renewSession, sessionCookie } from './security';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export function json(data: unknown, status = 200, extra?: HeadersInit) { return Response.json(data, { status, headers: extra }); }
export function fail(error: unknown): Response {
  if (error instanceof ApiError) return json({ error: error.message }, error.status);
  if (error instanceof ZodError) return json({ error: '输入内容不符合要求' }, 400);
  console.error('API error:', error instanceof Error ? error.name : 'UnknownError');
  return json({ error: '服务暂时不可用' }, 500);
}
export async function input<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  const max = 36 * 1024 * 1024;
  if (Number(request.headers.get('content-length') || 0) > max) throw new ApiError(413, '请求内容过大');
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error('Missing body');
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) { await reader.cancel(); throw new ApiError(413, '请求内容过大'); }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, '无效的 JSON 请求'); }
  return schema.parse(body);
}
export function sameOriginMutation(request: Request, extensionLogin = false) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  if (!extensionLogin && request.headers.has('authorization')) return;
  const origin = request.headers.get('origin');
  if (!origin) return;
  if (extensionLogin && /^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return;
  const expected = process.env.SAYSEED_PUBLIC_URL ? new URL(process.env.SAYSEED_PUBLIC_URL).origin : new URL(request.url).origin;
  if (origin !== expected) throw new ApiError(403, '请求来源无效');
}
export function guard(request: Request) { if (!authorized(request)) throw new ApiError(401, '请先登录'); sameOriginMutation(request); }
export function route(handler: (request: Request, context?: any) => Promise<Response> | Response) {
  return async (request: Request, context?: any) => {
    let response: Response;
    try { response = await handler(request, context); } catch (error) { response = fail(error); }
    const path = new URL(request.url).pathname;
    if (response.ok && request.headers.get('X-Sayseed-Activity') === '1' &&
      !['HEAD', 'OPTIONS'].includes(request.method) && !path.startsWith('/api/auth/') && path !== '/api/health') {
      const token = renewSession(request);
      if (token) {
        // Bearer tokens are returned only to extension clients; web sessions remain HttpOnly.
        if (request.headers.has('authorization')) response.headers.set('X-Sayseed-Session', token);
        else response.headers.append('Set-Cookie', sessionCookie(token));
      }
    }
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Sayseed-Activity');
    response.headers.set('Access-Control-Expose-Headers', 'X-Sayseed-Session');
    response.headers.set('Cache-Control', response.headers.get('Cache-Control') || 'no-store');
    return response;
  };
}
export function options() { return new Response(null, { status: 204, headers: {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Sayseed-Activity', 'Access-Control-Max-Age': '86400',
} }); }
