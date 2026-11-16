import type { ApiErrorBody, Config, TetherEvent } from './types';

export interface AuthCreds {
  username?: string;
  password?: string;
  token?: string;
}

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody | string | null;

  constructor(status: number, message: string, body: ApiErrorBody | string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export function normalizeBaseUrl(raw: string): string {
  let value = raw.trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) {
    value = value.startsWith('localhost') || value.startsWith('127.') || value.startsWith('[::1]') || /^\d+\.\d+\.\d+\.\d+/.test(value)
      ? `http://${value}`
      : `https://${value}`;
  }
  return value.replace(/\/+$/, '');
}

export function basicAuth(username = '', password = ''): string {
  return `Basic ${btoa(unescape(encodeURIComponent(`${username}:${password}`)))}`;
}

export function bearer(token: string): string {
  return `Bearer ${token}`;
}

function describeError(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const data = (body as ApiErrorBody).data;
    if (data?.message) return data.message;
    if (typeof (body as { message?: string }).message === 'string') return (body as { message: string }).message;
    if ((body as ApiErrorBody).name) return String((body as ApiErrorBody).name);
  }
  if (typeof body === 'string' && body.trim()) return body.slice(0, 300);
  return `Request failed with status ${status}`;
}

export class OpencodeClient {
  readonly baseUrl: string;
  readonly auth: AuthCreds;
  private authHeader: string | null;
  private lastEventId = '';
  private seenEventIds = new Set<string>();

  constructor(baseUrl: string, auth: AuthCreds = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.auth = auth;
    this.authHeader = auth.token ? bearer(auth.token) : auth.username || auth.password ? basicAuth(auth.username, auth.password) : null;
  }

  url(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    return `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json', ...extra };
    if (this.authHeader) headers.Authorization = this.authHeader;
    return headers;
  }

  async raw(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
    const signals = [init.signal, timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : null].filter(
      (signal): signal is AbortSignal => !!signal
    );
    return fetch(this.url(path), {
      ...init,
      credentials: 'same-origin',
      headers: this.headers(init.headers as Record<string, string> | undefined),
      signal: signals.length ? AbortSignal.any(signals) : undefined
    });
  }

  async request<T>(path: string, init: RequestInit = {}, timeoutMs = 30_000, onHeaders?: (headers: Headers) => void): Promise<T> {
    const res = await this.raw(path, init, timeoutMs);
    const text = await res.text();
    let body: unknown = text;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    } else {
      body = null;
    }
    if (!res.ok) {
      throw new ApiError(res.status, describeError(res.status, body), body as ApiErrorBody | string | null);
    }
    onHeaders?.(res.headers);
    return body as T;
  }

  get<T>(path: string, timeoutMs = 30_000): Promise<T> {
    return this.request<T>(path, { method: 'GET' }, timeoutMs);
  }

  async getPage<T>(path: string, timeoutMs = 30_000): Promise<{ data: T; nextCursor: string | null }> {
    let nextCursor: string | null = null;
    const data = await this.request<T>(path, { method: 'GET' }, timeoutMs, (headers) => {
      nextCursor = headers.get('x-next-cursor');
    });
    return { data, nextCursor };
  }

  post<T>(path: string, data?: unknown, timeoutMs = 60_000): Promise<T> {
    return this.request<T>(
      path,
      {
        method: 'POST',
        headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
        body: data === undefined ? undefined : JSON.stringify(data)
      },
      timeoutMs
    );
  }

  put<T>(path: string, data?: unknown, timeoutMs = 30_000): Promise<T> {
    return this.request<T>(
      path,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: data === undefined ? undefined : JSON.stringify(data)
      },
      timeoutMs
    );
  }

  patch<T>(path: string, data?: unknown, timeoutMs = 30_000): Promise<T> {
    return this.request<T>(
      path,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: data === undefined ? undefined : JSON.stringify(data)
      },
      timeoutMs
    );
  }

  delete<T>(path: string, timeoutMs = 30_000): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' }, timeoutMs);
  }

  async health(): Promise<{ healthy: boolean; version: string }> {
    return this.get<{ healthy: boolean; version: string }>('/global/health', 8000);
  }

  async config(): Promise<Config> {
    return this.get<Config>('/config', 8000);
  }

  async hostInfo(): Promise<unknown> {
    return this.get<unknown>('/api/tether/info', 6000);
  }

  async loginHost(username: string, password: string): Promise<unknown> {
    return this.post<unknown>('/api/tether/login', { username, password }, 10_000);
  }

  async logoutHost(): Promise<unknown> {
    return this.post<unknown>('/api/tether/logout', undefined, 10_000);
  }

  async *stream(path: string, signal: AbortSignal, onActivity?: () => void): AsyncGenerator<TetherEvent> {
    const res = await this.raw(path, { method: 'GET', headers: { Accept: 'text/event-stream', ...(this.lastEventId ? { 'Last-Event-ID': this.lastEventId } : {}) }, cache: 'no-store', signal }, 0);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(res.status, describeError(res.status, text), text);
    }
    if (!res.body) throw new ApiError(0, 'Event stream unavailable', null);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let pendingCR = false;
    let yieldedAt = performance.now();
    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        onActivity?.();
        let chunk = decoder.decode(value, { stream: true });
        if (pendingCR && chunk.startsWith('\n')) chunk = chunk.slice(1);
        if (chunk.length) pendingCR = chunk.endsWith('\r');
        buffer += chunk.replace(/\r\n?/g, '\n');
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1 && !signal.aborted) {
          if (boundary > 16 * 1024 * 1024) throw new ApiError(0, 'Event frame exceeds 16 MiB');
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          const idLine = block.split('\n').find((line) => line.startsWith('id:'));
          const id = idLine?.slice(3).replace(/^ /, '');
          if (id !== undefined && !id.includes('\0')) this.lastEventId = id;
          if (data && (!id || !this.seenEventIds.has(id))) {
            try {
              const parsed = JSON.parse(data) as TetherEvent & { payload?: TetherEvent };
              if (parsed && (typeof parsed.type === 'string' || typeof parsed.payload?.type === 'string')) {
                if (id) {
                  this.seenEventIds.add(id);
                  if (this.seenEventIds.size > 2048) this.seenEventIds.delete(this.seenEventIds.values().next().value!);
                }
                yield parsed;
              }
            } catch {
              // Ignore keepalive/partial frames.
            }
          }
          if (performance.now() - yieldedAt >= 8) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            yieldedAt = performance.now();
          }
          boundary = buffer.indexOf('\n\n');
        }
        if (buffer.length > 16 * 1024 * 1024) throw new ApiError(0, 'Event frame exceeds 16 MiB');
      }
    } finally {
      reader.releaseLock();
      res.body?.cancel().catch(() => {});
    }
  }
}
