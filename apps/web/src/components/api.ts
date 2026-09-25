export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      credentials: 'same-origin',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(typeof document !== 'undefined' && document.visibilityState === 'visible' ? { 'X-Sayseed-Activity': '1' } : {}),
        ...options.headers,
      },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('网络连接失败，请检查网络后重试。', 0);
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error : `请求失败（${response.status}）`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误，请重试。';
}
