export function sessionDetails(token: string): { exp: number; nonce: string } | undefined {
  try {
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return;
    const encoded = parts[0].replace(/-/g, '+').replace(/_/g, '/');
    const value = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    if (Number.isFinite(value.exp) && typeof value.nonce === 'string' && value.nonce) return { exp: value.exp, nonce: value.nonce };
  } catch { /* The server remains responsible for verifying signatures. */ }
}

export function activeSession(token: string): boolean {
  return (sessionDetails(token)?.exp || 0) > Date.now();
}

// Keep all background session mutations in one queue so late responses cannot undo logout or login.
let mutations: Promise<unknown> = Promise.resolve();
export function withSessionStorage<T>(work: () => Promise<T>): Promise<T> {
  const result = mutations.then(work);
  mutations = result.catch(() => {});
  return result;
}
