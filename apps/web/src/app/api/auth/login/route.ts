import { z } from 'zod';
import { input, json, route, ApiError, sameOriginMutation } from '../../../../server/http';
import { allowLoginAttempt, clearFailedLogins, configured, issueToken, recordFailedLogin, revokeSession, sessionCookie, verifyPassword } from '../../../../server/security';
export const runtime = 'nodejs';
export const POST = route(async request => {
  sameOriginMutation(request, true);
  if (!configured()) throw new ApiError(503, '请先设置 SAYSEED_PASSWORD');
  if (!allowLoginAttempt()) throw new ApiError(429, '登录尝试过多，请稍后再试');
  const { password } = await input(request, z.object({ password: z.string().min(1).max(1000) }));
  if (!verifyPassword(password)) { recordFailedLogin(); throw new ApiError(401, '密码错误'); }
  clearFailedLogins();
  revokeSession(request);
  const token = issueToken();
  return json({ token }, 200, { 'Set-Cookie': sessionCookie(token) });
});
export { options as OPTIONS } from '../../../../server/http';
