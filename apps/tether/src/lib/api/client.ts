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
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs) : null;
    const onAbort = () => controller.abort((init.signal as AbortSignal | undefined)?.reason);
    init.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await fetch(this.url(path), {
        ...init,
        headers: this.headers(init.headers as Record<string, string> | undefined),
        signal: controller.signal
      });
    } finally {
      if (timer) clearTimeout(timer);
      init.signal?.removeEventListener('abort', onAbort);
    }
  }

  async request<T>(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
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
    return body as T;
  }

  get<T>(path: string, timeoutMs = 30_000): Promise<T> {
    return this.request<T>(path, { method: 'GET' }, timeoutMs);
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

  async *stream(path: string, signal: AbortSignal): AsyncGenerator<TetherEvent> {
    const res = await this.raw(path, { method: 'GET', headers: { Accept: 'text/event-stream' }, signal }, 0);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(res.status, describeError(res.status, text), text);
    }
    if (!res.body) throw new ApiError(0, 'Event stream unavailable', null);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (data) {
            try {
              const parsed = JSON.parse(data) as TetherEvent;
              if (parsed && typeof parsed.type === 'string') yield parsed;
            } catch {
              // Ignore keepalive/partial frames.
            }
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
    } finally {
      reader.releaseLock();
      res.body?.cancel().catch(() => {});
    }
  }
}
