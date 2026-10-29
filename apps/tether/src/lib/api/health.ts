import type { Remote, RemoteHealth, SessionStatus } from './types';
import { ApiError, OpencodeClient } from './client';

export async function checkRemote(remote: Remote): Promise<RemoteHealth> {
  const client = new OpencodeClient(remote.url, {
    username: remote.username,
    password: remote.password,
    token: remote.token
  });
  const start = performance.now();
  try {
    const health = await client.health();
    const latencyMs = Math.round(performance.now() - start);
    let busySessions = 0;
    try {
      const statuses = await client.get<Record<string, SessionStatus>>('/session/status', 8000);
      busySessions = Object.values(statuses).filter((status) => status.type !== 'idle').length;
    } catch {
      // The host may not expose status to this user.
    }
    return {
      state: busySessions > 0 ? 'online' : 'idle',
      latencyMs,
      version: health.version,
      busySessions,
      checkedAt: Date.now()
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { state: 'unauthorized', checkedAt: Date.now(), error: 'Authentication failed' };
    }
    return {
      state: 'offline',
      checkedAt: Date.now(),
      error: error instanceof Error ? (error.name === 'TimeoutError' ? 'Timed out' : error.message) : 'Unreachable'
    };
  }
}

export async function testRemote(url: string, auth: { username?: string; password?: string; token?: string }): Promise<RemoteHealth> {
  return checkRemote({
    id: 'test',
    name: 'test',
    url,
    kind: 'remote',
    createdAt: Date.now(),
    ...auth
  });
}
