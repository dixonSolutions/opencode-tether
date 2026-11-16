import { updateTranscript, reconcileTranscript } from './transcript';
import { ApiError, OpencodeClient, normalizeBaseUrl } from '$lib/api/client';
import type {
  Agent,
  Command,
  Config,
  DiffFile,
  FileNode,
  HostInfo,
  MessageWithParts,
  Model,
  Part,
  PermissionRequest,
  PromptBody,
  Provider,
  QuestionRequest,
  Remote,
  RemoteHealth,
  Session,
  SessionStatus,
  Todo,
  TetherEvent
} from '$lib/api/types';
import { initPlatformClasses, notify, isTauri } from '$lib/platform';
import { persistentStore } from '$lib/storage.svelte';
import { settings, type ModelRef } from './settings.svelte';
import { toast } from 'svelte-sonner';
import { setMode } from 'mode-watcher';

export type Phase = 'boot' | 'needs-remote' | 'host-login' | 'connecting' | 'ready' | 'offline' | 'unauthorized' | 'error';
export type EventState = 'off' | 'connecting' | 'live' | 'reconnecting';

/** How often an open event stream is checked for silence. */
const STALL_CHECK_MS = 5_000;
/** Silence after which the host is probed. */
const STALL_AFTER_MS = 30_000;
/** Silence after which the stream is dropped even if the host still answers. */
const DEAD_AFTER_MS = 45_000;

const SESSION_POLL_MS = 20_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      signal?.removeEventListener('abort', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

function parseModel(value: string | undefined): ModelRef | null {
  if (!value || !value.includes('/')) return null;
  const slash = value.indexOf('/');
  return { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) };
}

function sessionUpdated(session: Session): number {
  return session.time?.updated ?? session.time?.created ?? 0;
}

function trimTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function sameDirectory(a: string | undefined, b: string): boolean {
  return !!a && trimTrailingSlash(a) === trimTrailingSlash(b);
}

function normalizeDirectory(input: string, base: string, home: string): string | null {
  let value = input.trim();
  if (!value) return null;
  if (value === '~') value = home;
  else if (value.startsWith('~/')) value = `${home.replace(/\/+$/, '')}/${value.slice(2)}`;
  if (!value.startsWith('/')) value = `${base.replace(/\/+$/, '')}/${value}`;
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}` || '/';
}

export class AppState {
  phase = $state<Phase>('boot');
  eventState = $state<EventState>('off');
  hostMode = $state(false);
  host = $state<HostInfo | null>(null);
  activeRemote = $state<Remote | null>(null);
  connection = $state<RemoteHealth>({ state: 'unknown' });

  sessions = $state<Session[]>([]);
  agents = $state<Agent[]>([]);
  commands = $state<Command[]>([]);
  config = $state<Config | null>(null);
  providers = $state<Provider[] | null>(null);
  providersLoading = $state(false);

  selectedSessionId = $state<string | null>(null);
  messages = $state.raw<MessageWithParts[]>([]);
  statuses = $state<Record<string, SessionStatus>>({});
  todos = $state<Record<string, Todo[]>>({});
  permissions = $state<PermissionRequest[]>([]);
  questions = $state<QuestionRequest[]>([]);
  diffs = $state<Record<string, DiffFile[]>>({});

  sessionsLoading = $state(false);
  messagesLoading = $state(false);
  sending = $state(false);
  loadingOlder = $state(false);
  hasOlderMessages = $state(false);
  lastError = $state<string | null>(null);
  search = $state('');
  drafts = $state<Record<string, string>>({});
  selectedAgent = $state('build');
  selectedModel = $state<ModelRef | null>(null);
  selectedDirectory = $state<string | null>(null);
  directoryBrowser = $state<{
    home: string | null;
    path: string | null;
    parent: string | null;
    entries: FileNode[];
    searchResults: string[];
    query: string;
    loading: boolean;
    searching: boolean;
    error: string | null;
  }>({ home: null, path: null, parent: null, entries: [], searchResults: [], query: '', loading: false, searching: false, error: null });
  hostAuth = $state<{ username: string; password: string } | null>(null);
  booted = $state(false);

  client: OpencodeClient | null = null;
  private abortEvents: AbortController | null = null;
  private eventGeneration = 0;
  private legacyEvents = false;
  private messageRequestId = 0;
  private nextMessageCursor: string | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private initialRequestId = 0;
  private initialEvents: TetherEvent[] | null = null;
  private pendingTranscript: TetherEvent[] = [];
  private transcriptTimer: ReturnType<typeof setTimeout> | null = null;
  private streamAttempt: AbortController | null = null;
  private lastEventActivity = 0;
  private syncInFlight: Promise<void> | null = null;
  private resolvedRequests = new Set<string>();
  private knownQuestionDirectories = new Set<string>();
  private defaultDirectory: string | null = null;
  private sessionSelectionId = 0;
  private requestDirectories = new Map<string, string>();
  private sessionLookups = new Map<string, Promise<void>>();
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  get selectedSession(): Session | undefined {
    return this.sessions.find((session) => session.id === this.selectedSessionId);
  }

  get selectedStatus(): SessionStatus {
    return this.selectedSessionId ? (this.statuses[this.selectedSessionId] ?? { type: 'idle' }) : { type: 'idle' };
  }

  get isBusy(): boolean {
    return this.selectedStatus.type !== 'idle';
  }

  get sessionPermissions(): PermissionRequest[] {
    return this.selectedSessionId ? this.permissions.filter((item) => item.sessionID === this.selectedSessionId) : [];
  }

  get sessionQuestions(): QuestionRequest[] {
    return this.selectedSessionId ? this.questions.filter((item) => item.sessionID === this.selectedSessionId) : [];
  }

  get sessionTodos(): Todo[] {
    return this.selectedSessionId ? (this.todos[this.selectedSessionId] ?? []) : [];
  }

  get sessionDiffs(): DiffFile[] {
    return this.selectedSessionId ? (this.diffs[this.selectedSessionId] ?? []) : [];
  }

  get pendingCount(): number {
    return this.permissions.length + this.questions.length;
  }

  get modelCatalog(): Model[] {
    if (!this.providers) return [];
    return this.providers.flatMap((provider) =>
      Object.values(provider.models ?? {}).map((model) => ({ ...model, providerID: model.providerID ?? provider.id }))
    );
  }

  get visibleAgents(): Agent[] {
    return this.agents.filter((agent) => !agent.hidden && (agent.mode === 'primary' || agent.mode === 'all'));
  }

  get filteredSessions(): Session[] {
    const query = this.search.trim().toLowerCase();
    const scoped = this.selectedDirectory
      ? this.sessions.filter((session) => sameDirectory(session.directory, this.selectedDirectory!))
      : this.sessions;
    if (!query) return scoped;
    return scoped.filter(
      (session) =>
        (session.title ?? '').toLowerCase().includes(query) ||
        (session.directory ?? '').toLowerCase().includes(query) ||
        (session.slug ?? '').toLowerCase().includes(query)
    );
  }

  private directoryKey(): string {
    if (this.hostMode) return 'host';
    return this.activeRemote?.id ?? 'remote';
  }

  /** Folders chosen on the current host, newest first. */
  get recentDirectories(): string[] {
    return settings.recentDirectories[this.directoryKey()] ?? [];
  }

  forgetRecentDirectory(directory: string): void {
    settings.forgetDirectory(this.directoryKey(), directory);
  }

  setDirectory(directory: string | null): void {
    const base = this.directoryBrowser.path ?? this.directoryBrowser.home ?? '/';
    const home = this.directoryBrowser.home ?? base;
    const value = directory ? normalizeDirectory(directory, base, home) : null;
    this.selectedDirectory = value;
    const next = { ...settings.lastDirectory };
    const key = this.directoryKey();
    if (value) {
      next[key] = value;
      settings.rememberDirectory(key, value);
    } else {
      delete next[key];
    }
    settings.lastDirectory = next;
  }

  private browseGeneration = 0;

  async openDirectoryBrowser(start?: string | null): Promise<void> {
    if (!this.client) return;
    const generation = ++this.browseGeneration;
    this.directoryBrowser = { ...this.directoryBrowser, error: null, loading: true };
    try {
      const info = await this.client.get<{ home?: string; directory?: string; worktree?: string }>('/path', 10_000);
      if (generation !== this.browseGeneration) return;
      const home = info.home ?? info.directory ?? '/';
      const target = start || this.selectedDirectory || home;
      this.directoryBrowser = { ...this.directoryBrowser, home, loading: false };
      await this.browseDirectory(target);
    } catch (error) {
      if (generation !== this.browseGeneration) return;
      this.noteBrowseAuth(error);
      this.directoryBrowser = {
        ...this.directoryBrowser,
        path: null,
        parent: null,
        entries: [],
        searchResults: [],
        loading: false,
        error: this.describeBrowseError(error)
      };
    }
  }

  async browseDirectory(path: string): Promise<void> {
    if (!this.client) return;
    const generation = ++this.browseGeneration;
    ++this.searchGeneration;
    const base = this.directoryBrowser.path ?? this.directoryBrowser.home ?? '/';
    const home = this.directoryBrowser.home ?? base;
    const clean = normalizeDirectory(path, base, home) ?? '/';
    this.directoryBrowser = { ...this.directoryBrowser, loading: true, error: null, query: '', searchResults: [], searching: false };
    try {
      const entries = await this.client.get<FileNode[]>(`/file?path=${encodeURIComponent(clean)}`, 15_000);
      if (generation !== this.browseGeneration) return;
      this.directoryBrowser = {
        ...this.directoryBrowser,
        path: clean,
        parent: clean === '/' ? null : clean.replace(/\/[^/]+\/?$/, '') || '/',
        entries: entries
          .filter((entry) => entry.type === 'directory')
          .sort((a, b) => Number(a.name.startsWith('.')) - Number(b.name.startsWith('.')) || a.name.localeCompare(b.name)),
        loading: false
      };
    } catch (error) {
      if (generation !== this.browseGeneration) return;
      this.noteBrowseAuth(error);
      this.directoryBrowser = {
        ...this.directoryBrowser,
        path: clean,
        parent: clean === '/' ? null : clean.replace(/\/[^/]+\/?$/, '') || '/',
        loading: false,
        entries: [],
        searchResults: [],
        error: this.describeBrowseError(error, clean)
      };
    }
  }

  private searchGeneration = 0;

  async searchDirectories(query: string): Promise<void> {
    if (!this.client) {
      this.directoryBrowser = { ...this.directoryBrowser, searching: false };
      return;
    }
    const generation = ++this.searchGeneration;
    const q = query.trim().toLowerCase();
    if (!q) {
      this.directoryBrowser = { ...this.directoryBrowser, searchResults: [], searching: false };
      return;
    }
    const base = this.directoryBrowser.path ?? this.directoryBrowser.home ?? '/';
    this.directoryBrowser = { ...this.directoryBrowser, searching: true };
    if (this.hostMode) {
      // One request, walked on the host. Hosts from before this endpoint answer 404 and
      // fall through to the browser walk below.
      try {
        const found = await this.client.get<{ results: string[] }>(
          `/api/tether/folders/search?root=${encodeURIComponent(base)}&q=${encodeURIComponent(q)}`,
          8_000
        );
        if (generation === this.searchGeneration) {
          const matches = this.directoryBrowser.path === base ? found.results : [];
          this.directoryBrowser = { ...this.directoryBrowser, searchResults: matches, searching: false };
        }
        return;
      } catch (error) {
        if (generation !== this.searchGeneration) return;
        if (error instanceof ApiError && error.status === 401) {
          this.directoryBrowser = { ...this.directoryBrowser, searchResults: [], searching: false };
          return;
        }
      }
    }
    const skip = new Set([
      'node_modules',
      '.git',
      '.cache',
      '.local',
      '.cargo',
      '.npm',
      '.rustup',
      '.gradle',
      '.android',
      'target',
      'build',
      'dist',
      '.next',
      '.svelte-kit',
      '.venv',
      'venv',
      '__pycache__'
    ]);
    const results: string[] = [];
    const seenResults = new Set<string>();
    const visited = new Set<string>([base]);
    let frontier: Array<{ path: string; relative: string; depth: number }> = [{ path: base, relative: '', depth: 0 }];
    let listed = 0;
    try {
      while (frontier.length && listed < 140 && results.length < 60) {
        const batch = frontier.splice(0, 8);
        await Promise.all(
          batch.map(async (node) => {
            if (generation !== this.searchGeneration || !this.client) return;
            listed++;
            try {
              const entries = await this.client.get<FileNode[]>(`/file?path=${encodeURIComponent(node.path)}`, 10_000);
              if (generation !== this.searchGeneration) return;
              for (const entry of entries) {
                if (entry.type !== 'directory') continue;
                const name = entry.name.replace(/\/+$/, '');
                if (!name || name.startsWith('.') || skip.has(name)) continue;
                const relative = node.relative ? `${node.relative}/${name}` : name;
                const absolute = entry.absolute ?? `${node.path.replace(/\/+$/, '')}/${name}`;
                if (relative.toLowerCase().includes(q) && !seenResults.has(relative) && results.length < 60) {
                  seenResults.add(relative);
                  results.push(relative);
                }
                if (node.depth < 3 && !visited.has(absolute)) {
                  visited.add(absolute);
                  frontier.push({ path: absolute, relative, depth: node.depth + 1 });
                }
              }
            } catch {
              // A folder can be unreadable while its siblings are still searchable.
            }
          })
        );
      }
      if (generation === this.searchGeneration && this.directoryBrowser.path === base) {
        this.directoryBrowser = { ...this.directoryBrowser, searchResults: results.sort((a, b) => a.localeCompare(b)), searching: false };
      } else if (generation === this.searchGeneration) {
        this.directoryBrowser = { ...this.directoryBrowser, searchResults: [], searching: false };
      }
    } catch {
      if (generation === this.searchGeneration) {
        this.directoryBrowser = { ...this.directoryBrowser, searchResults: [], searching: false };
      }
    }
  }

  private noteBrowseAuth(error: unknown): void {
    if (!(error instanceof ApiError) || error.status !== 401) return;
    this.connection = { state: 'unauthorized' };
    this.phase = this.hostMode ? 'host-login' : 'unauthorized';
    this.lastError = 'Authentication required. Sign in again to browse folders.';
  }

  private describeBrowseError(error: unknown, path?: string): string {
    if (error instanceof ApiError) {
      if (error.status === 401) return 'Authentication required. Sign in again to browse folders.';
      if (error.status === 403) return 'This host does not allow reading that folder. Check the opencode directory permissions.';
      if (error.status === 404) return `That folder does not exist on the host${path ? `: ${path}` : ''}.`;
      if (error.status === 400 || error.status >= 500) {
        return `Could not read ${path ?? 'that folder'}. It may not exist, or the host may not allow access to it.`;
      }
      return error.message;
    }
    return error instanceof Error ? error.message : 'Could not read that folder on the host.';
  }

  private resetDirectoryBrowser(): void {
    ++this.browseGeneration;
    ++this.searchGeneration;
    this.directoryBrowser = {
      home: null,
      path: null,
      parent: null,
      entries: [],
      searchResults: [],
      query: '',
      loading: false,
      searching: false,
      error: null
    };
  }

  async boot(): Promise<void> {
    if (this.booted) return;
    this.booted = true;
    await settings.init();
    await initPlatformClasses();
    setMode(settings.theme);
    await this.loadDrafts();

    const params = new URLSearchParams(window.location.search);
    const forceRemotes = params.get('remotes') === '1';

    this.host = await this.detectHost();
    if (this.host) {
      this.hostMode = true;
      const stored = persistentStore.get<{ username: string; password: string } | null>('hostAuth', null);
      this.hostAuth = stored;
      if (!this.host.requiresAuth) {
        await this.connectHost('', '');
      } else if (stored?.username) {
        await this.connectHost(stored.username, stored.password ?? '');
      } else {
        this.phase = 'host-login';
      }
      return;
    }

    if (forceRemotes) {
      this.phase = 'needs-remote';
      return;
    }

    const remote = settings.lastRemote;
    if (!remote) {
      this.phase = 'needs-remote';
      return;
    }
    await this.connect(remote);
  }

  private async detectHost(): Promise<HostInfo | null> {
    if (isTauri()) return null;
    if (!document.querySelector('meta[name="opencode-tether-host"]')) return null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const res = await fetch('/api/tether/info', { signal: controller.signal, headers: { Accept: 'application/json' } });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = (await res.json()) as HostInfo;
      if (data?.mode === 'host' && data.name === 'opencode-tether') return data;
      return null;
    } catch {
      return null;
    }
  }

  async connect(remote: Remote): Promise<void> {
    this.activeRemote = remote;
    this.hostMode = false;
    this.connection = { state: 'checking' };
    this.phase = 'connecting';
    this.lastError = null;
    this.stopEvents();
    const client = new OpencodeClient(remote.url, {
      username: remote.username,
      password: remote.password,
      token: remote.token
    });
    this.client = client;
    this.resetRequests();
    this.legacyEvents = false;
    this.providers = null;
    this.providersLoading = false;
    try {
      const started = performance.now();
      const health = await client.health();
      if (this.client !== client) return;
      this.connection = { state: 'idle', version: health.version, latencyMs: Math.round(performance.now() - started), checkedAt: Date.now() };
      settings.touchRemote(remote.id);
      await this.afterConnect();
    } catch (error) {
      if (this.client === client) this.handleConnectError(error, remote);
    }
  }

  async connectHost(username: string, password: string): Promise<void> {
    this.connection = { state: 'checking' };
    this.phase = 'connecting';
    this.lastError = null;
    this.stopEvents();
    const basic = new OpencodeClient(window.location.origin, { username, password });
    this.client = basic;
    this.resetRequests();
    this.legacyEvents = false;
    try {
      if (username) {
        // Verify once, then rely on the signed HttpOnly cookie. This keeps Argon2 off
        // every API request and makes health checks cheap.
        await basic.loginHost(username, password);
        this.client = new OpencodeClient(window.location.origin);
        this.hostAuth = { username, password };
        persistentStore.set('hostAuth', { username, password });
        try {
          localStorage.setItem('opencode-tether.host', JSON.stringify({ username, savedAt: Date.now() }));
        } catch {
          // localStorage can be unavailable in private contexts.
        }
      }
      const started = performance.now();
      const health = await this.client.health();
      this.connection = { state: 'idle', version: health.version, latencyMs: Math.round(performance.now() - started), checkedAt: Date.now() };
      await this.afterConnect();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.phase = 'host-login';
        this.connection = { state: 'unauthorized' };
        this.lastError = 'Incorrect username or password.';
        persistentStore.set('hostAuth', null);
      } else {
        this.phase = 'offline';
        this.connection = { state: 'offline', error: error instanceof Error ? error.message : String(error) };
        this.lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  private async afterConnect(): Promise<void> {
    const client = this.client;
    if (!client) return;
    this.selectedDirectory = settings.lastDirectory[this.directoryKey()] ?? null;
    this.selectedAgent = settings.lastAgent || 'build';
    this.phase = 'ready';
    this.eventState = 'connecting';
    this.reconnectAttempt = 0;
    this.startEvents();
    this.startHealthPolling();
    await this.refreshInitial();
    void this.pollHealth();
    if (client !== this.client) return;
    const key = this.activeRemote ? `lastSession:${this.activeRemote.id}` : 'hostLastSession';
    const savedSession = persistentStore.get<string | null>(key, null);
    const deepLink = new URLSearchParams(window.location.search).get('session');
    const requested = deepLink ?? savedSession;
    let target = this.sessions.find((session) => session.id === requested);
    if (!target && requested) {
      try {
        const session = await client.get<Session>(`/session/${encodeURIComponent(requested)}`, 15_000);
        if (client !== this.client) return;
        if (session.id === requested) {
          this.upsertSession(session);
          target = session;
        }
      } catch {
        if (client !== this.client) return;
      }
    }
    if (!target && !deepLink) target = this.sessions[0];
    if (target) await this.openSession(target.id, { replace: true });
  }

  private handleConnectError(error: unknown, remote: Remote): void {
    if (error instanceof ApiError && error.status === 401) {
      this.phase = 'unauthorized';
      this.connection = { state: 'unauthorized' };
      this.lastError = 'Authentication failed. Check the username and password for this host.';
      return;
    }
    this.phase = 'offline';
    const message =
      error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.name === 'TimeoutError'
            ? `Timed out connecting to ${remote.url}`
            : error.message
          : String(error);
    this.connection = { state: 'offline', error: message };
    this.lastError = message;
  }

  async retry(): Promise<void> {
    if (this.hostMode) {
      if (this.hostAuth) await this.connectHost(this.hostAuth.username, this.hostAuth.password);
      else this.phase = 'host-login';
      return;
    }
    if (this.activeRemote) await this.connect(this.activeRemote);
  }

  async switchRemote(remote: Remote): Promise<void> {
    if (this.activeRemote?.id === remote.id && this.phase === 'ready') return;
    this.selectedSessionId = null;
    this.messages = [];
    this.sessions = [];
    this.directoryBrowser = { home: null, path: null, parent: null, entries: [], searchResults: [], query: '', loading: false, searching: false, error: null };
    await this.connect(remote);
  }

  private directoryPath(path: string, sessionID = this.selectedSessionId): string {
    const directory = this.sessions.find((session) => session.id === sessionID)?.directory ?? this.selectedDirectory ?? this.defaultDirectory;
    return directory ? `${path}${path.includes('?') ? '&' : '?'}directory=${encodeURIComponent(directory)}` : path;
  }

  private resetRequests(): void {
    this.permissions = [];
    this.questions = [];
    this.knownQuestionDirectories.clear();
    this.defaultDirectory = null;
    this.requestDirectories.clear();
    this.resolvedRequests.clear();
    this.sessionLookups.clear();
  }

  private resolveQuestion(requestID: string): void {
    this.resolvedRequests.add(requestID);
    this.questions = this.questions.filter((item) => item.id !== requestID);
  }

  private requestDirectory(sessionID = this.selectedSessionId): string | null {
    return this.sessions.find((session) => session.id === sessionID)?.directory ?? this.selectedDirectory ?? this.defaultDirectory;
  }

  private requestPath(path: string, directory: string | null): string {
    return directory ? `${path}?directory=${encodeURIComponent(directory)}` : path;
  }

  private mergeScopedRequests<T extends { id: string; sessionID: string }>(current: T[], incoming: T[], directory: string | null, baseline: T[]): T[] {
    // Scope belongs to the HTTP request, not the (possibly changed/capped) session list.
    const inScope = (request: T) => {
      const known = this.requestDirectories.get(request.id) ?? this.sessions.find((session) => session.id === request.sessionID)?.directory;
      return !!directory && sameDirectory(known, directory);
    };
    const merged = new Map(current.filter((request) => !inScope(request)).map((request) => [request.id, request]));
    for (const request of incoming) {
      if (this.resolvedRequests.has(request.id)) continue;
      merged.set(request.id, request);
      if (directory) this.requestDirectories.set(request.id, directory);
    }
    const before = new Map(baseline.map((request) => [request.id, request]));
    const live = new Set(current.map((request) => request.id));
    for (const request of current) if (request !== before.get(request.id)) merged.set(request.id, request);
    for (const id of before.keys()) if (!live.has(id)) merged.delete(id);
    return [...merged.values()];
  }

  private async ensureSession(sessionID: string): Promise<void> {
    if (this.sessions.some((session) => session.id === sessionID)) return;
    const existing = this.sessionLookups.get(sessionID);
    if (existing) return existing;
    const client = this.client;
    if (!client) return;
    const lookup = (async () => {
      try {
        const session = await client.get<Session>(`/session/${encodeURIComponent(sessionID)}`, 15_000);
        if (client === this.client && session.id === sessionID) this.upsertSession(session);
      } catch {
        // Keep the request even if session metadata is temporarily unavailable.
      }
    })();
    this.sessionLookups.set(sessionID, lookup);
    try { await lookup; } finally { if (this.sessionLookups.get(sessionID) === lookup) this.sessionLookups.delete(sessionID); }
  }

  private mergeSessions(incoming: Session[]): void {
    for (const session of [...this.sessions, ...incoming]) if (session.directory) this.knownQuestionDirectories.add(session.directory);
    const retained = new Set([this.selectedSessionId, ...this.permissions.map((request) => request.sessionID), ...this.questions.map((request) => request.sessionID)]);
    this.sessions = [...new Map([...this.sessions.filter((session) => retained.has(session.id)), ...incoming].map((session) => [session.id, session])).values()]
      .sort((a, b) => sessionUpdated(b) - sessionUpdated(a));
  }

  private mergeScopedStatuses(incoming: Record<string, SessionStatus>, sessionID = this.selectedSessionId, baseline = this.statuses): Record<string, SessionStatus> {
    const directory = this.sessions.find((session) => session.id === sessionID)?.directory;
    if (!directory) return { ...incoming };
    const scope = new Set(this.sessions.filter((session) => session.directory === directory).map((session) => session.id));
    const merged = { ...Object.fromEntries(Object.entries(this.statuses).filter(([id]) => !scope.has(id))), ...incoming };
    for (const [id, status] of Object.entries(this.statuses)) if (status !== baseline[id]) merged[id] = status;
    return merged;
  }

  async refreshInitial(): Promise<void> {
    if (!this.client) return;
    const client = this.client;
    const sessionID = this.selectedSessionId;
    const directory = this.requestDirectory();
    const permissionBaseline = this.permissions;
    const questionBaseline = this.questions;
    const requestId = ++this.initialRequestId;
    const events: TetherEvent[] = [];
    this.initialEvents = events;
    this.sessionsLoading = true;
    const results = await Promise.allSettled([
      this.client.get<Session[]>('/session', 20_000),
      this.client.get<Agent[]>(this.directoryPath('/agent'), 15_000),
      this.client.get<Command[]>(this.directoryPath('/command'), 15_000),
      this.client.get<Config>(this.directoryPath('/config'), 15_000),
      this.client.get<Record<string, SessionStatus>>(this.directoryPath('/session/status'), 15_000),
      // Requests already waiting when the app connects are not replayed as events, so load them here.
      this.client.get<PermissionRequest[]>(this.requestPath('/permission', directory), 15_000),
      this.client.get<QuestionRequest[]>(this.requestPath('/question', directory), 15_000),
      this.client.get<{ directory?: string }>('/path', 10_000)
    ]);
    if (this.client !== client || requestId !== this.initialRequestId) return;
    this.initialEvents = null;
    const [sessions, agents, commands, config, statuses, permissions, questions, path] = results;
    if (path.status === 'fulfilled') this.defaultDirectory = path.value.directory ?? null;
    const requestDirectory = directory ?? this.defaultDirectory;
    if (sessions.status === 'fulfilled') this.mergeSessions(sessions.value);
    if (agents.status === 'fulfilled') this.agents = agents.value;
    if (commands.status === 'fulfilled') this.commands = commands.value.filter((command) => command.name);
    if (config.status === 'fulfilled') this.config = config.value;
    if (statuses.status === 'fulfilled') this.statuses = this.mergeScopedStatuses(statuses.value, sessionID);
    if (permissions.status === 'fulfilled') this.permissions = this.mergeScopedRequests(this.permissions, permissions.value, requestDirectory, permissionBaseline);
    if (questions.status === 'fulfilled') this.questions = this.mergeScopedRequests(this.questions, questions.value, requestDirectory, questionBaseline);

    const configModel = parseModel(typeof this.config?.model === 'string' ? this.config.model : undefined);
    this.selectedModel ??= settings.lastModel ?? configModel ?? null;
    if (!this.visibleAgents.some((agent) => agent.name === this.selectedAgent)) {
      this.selectedAgent = this.visibleAgents.find((agent) => agent.name === settings.lastAgent)?.name ?? this.visibleAgents[0]?.name ?? 'build';
    }
    this.selectedDirectory = settings.lastDirectory[this.directoryKey()] ?? null;

    for (const event of events) this.applyEvent(event, true);
    await Promise.all([...new Set([...this.permissions, ...this.questions].map((request) => request.sessionID))].map((id) => this.ensureSession(id)));
    await this.refreshQuestions();
    this.sessionsLoading = false;
    if (sessions.status === 'rejected') {
      const reason = sessions.reason;
      if (reason instanceof ApiError && reason.status === 401) {
        this.phase = 'unauthorized';
        this.connection = { state: 'unauthorized' };
      }
    }
  }

  async refreshSessions(): Promise<void> {
    if (!this.client) return;
    const client = this.client;
    try {
      const sessions = await client.get<Session[]>('/session', 20_000);
      if (client === this.client) this.mergeSessions(sessions);
    } catch (error) {
      if (client !== this.client) return;
      if (error instanceof ApiError && error.status === 401) this.phase = 'unauthorized';
    }
  }

  async openSession(sessionID: string, options: { replace?: boolean } = {}): Promise<void> {
    if (!this.client) return;
    const client = this.client;
    const selection = ++this.sessionSelectionId;
    await this.ensureSession(sessionID);
    if (client !== this.client || selection !== this.sessionSelectionId) return;
    const previousDirectory = this.selectedSession?.directory;
    this.flushTranscript();
    if (this.selectedSessionId !== sessionID) {
      this.messages = [];
      this.hasOlderMessages = false;
      this.nextMessageCursor = null;
      this.loadingOlder = false;
    }
    this.selectedSessionId = sessionID;
    if (!options.replace) {
      const url = new URL(window.location.href);
      url.searchParams.set('session', sessionID);
      history.replaceState(history.state, '', url);
    }
    const key = this.activeRemote ? `lastSession:${this.activeRemote.id}` : 'hostLastSession';
    persistentStore.set(key, sessionID);

    const session = this.sessions.find((item) => item.id === sessionID);
    if (session?.agent) this.selectedAgent = session.agent;
    if (this.legacyEvents && previousDirectory !== session?.directory) {
      this.startEvents();
      this.startHealthPolling();
    }
    await Promise.all([
      this.refreshMessages(sessionID), this.refreshTodos(sessionID), this.refreshDiffs(sessionID),
      this.refreshPermissions(), this.refreshQuestions(),
      previousDirectory !== session?.directory ? this.refreshSessionContext(sessionID) : Promise.resolve()
    ]);
  }

  private async refreshSessionContext(sessionID: string): Promise<void> {
    const client = this.client;
    if (!client) return;
    this.providers = null;
    this.providersLoading = false;
    const [agents, commands, config] = await Promise.allSettled([
      client.get<Agent[]>(this.directoryPath('/agent', sessionID), 15_000),
      client.get<Command[]>(this.directoryPath('/command', sessionID), 15_000),
      client.get<Config>(this.directoryPath('/config', sessionID), 15_000)
    ]);
    if (client !== this.client || sessionID !== this.selectedSessionId) return;
    if (agents.status === 'fulfilled') {
      this.agents = agents.value;
      if (!this.visibleAgents.some((agent) => agent.name === this.selectedAgent)) this.selectedAgent = this.visibleAgents[0]?.name ?? 'build';
    }
    if (commands.status === 'fulfilled') this.commands = commands.value.filter((command) => command.name);
    if (config.status === 'fulfilled') this.config = config.value;
  }

  async refreshMessages(sessionID = this.selectedSessionId): Promise<void> {
    if (!this.client || !sessionID) return;
    this.flushTranscript();
    const client = this.client;
    const baseline = this.messages;
    const limit = Math.max(60, baseline.length);
    const gen = ++this.messageRequestId;
    this.messagesLoading = true;
    try {
      const page = await client.getPage<MessageWithParts[]>(this.directoryPath(`/session/${sessionID}/message?limit=${limit}`, sessionID), 30_000);
      const messages = page.data;
      if (gen === this.messageRequestId && sessionID === this.selectedSessionId && client === this.client) {
        this.flushTranscript();
        this.messages = reconcileTranscript(messages, baseline, this.messages);
        this.nextMessageCursor = page.nextCursor;
        this.hasOlderMessages = !!page.nextCursor || messages.length === limit;
      }
    } catch (error) {
      if (client !== this.client) return;
      if (error instanceof ApiError && error.status === 401) this.phase = 'unauthorized';
    } finally {
      if (gen === this.messageRequestId) this.messagesLoading = false;
    }
  }

  async loadEarlierMessages(): Promise<void> {
    const client = this.client;
    const sessionID = this.selectedSessionId;
    const before = this.nextMessageCursor;
    if (!client || !sessionID || !this.hasOlderMessages || this.loadingOlder) return;
    const gen = this.messageRequestId;
    this.loadingOlder = true;
    try {
      const query = before ? `limit=60&before=${encodeURIComponent(before)}` : 'limit=0';
      const page = await client.getPage<MessageWithParts[]>(this.directoryPath(`/session/${sessionID}/message?${query}`, sessionID), 30_000);
      if (client !== this.client || sessionID !== this.selectedSessionId || gen !== this.messageRequestId) return;
      this.flushTranscript();
      const existing = new Set(this.messages.map((message) => message.info.id));
      const earlier = page.data.filter((message) => !existing.has(message.info.id));
      this.messages = [...earlier, ...this.messages].sort((a, b) => a.info.time.created - b.info.time.created || a.info.id.localeCompare(b.info.id));
      this.nextMessageCursor = page.nextCursor;
      this.hasOlderMessages = !!page.nextCursor && earlier.length > 0;
    } catch (error) {
      if (client === this.client) this.showError(error, 'Could not load earlier messages');
    } finally {
      if (client === this.client && sessionID === this.selectedSessionId) this.loadingOlder = false;
    }
  }

  async refreshTodos(sessionID = this.selectedSessionId): Promise<void> {
    if (!this.client || !sessionID) return;
    const client = this.client;
    try {
      const todos = await client.get<Todo[]>(this.directoryPath(`/session/${sessionID}/todo`, sessionID), 10_000);
      if (client === this.client) this.todos = { ...this.todos, [sessionID]: todos };
    } catch {
      // Todos are optional.
    }
  }

  async refreshDiffs(sessionID = this.selectedSessionId): Promise<void> {
    if (!this.client || !sessionID) return;
    const client = this.client;
    try {
      const diffs = await client.get<DiffFile[]>(this.directoryPath(`/session/${sessionID}/diff`, sessionID), 15_000);
      if (client === this.client) this.diffs = { ...this.diffs, [sessionID]: diffs };
    } catch {
      // Diffs are optional until the agent changes files.
    }
  }

  selectSession(sessionID: string): void {
    void this.openSession(sessionID);
  }

  async newSession(): Promise<Session | null> {
    if (!this.client) return null;
    try {
      const body: Record<string, unknown> = {};
      if (this.selectedAgent) body.agent = this.selectedAgent;
      if (this.selectedModel) body.model = { id: this.selectedModel.modelID, providerID: this.selectedModel.providerID };
      const query = this.selectedDirectory ? `?directory=${encodeURIComponent(this.selectedDirectory)}` : '';
      const session = await this.client.post<Session>(`/session${query}`, body, 30_000);
      this.sessions = [session, ...this.sessions];
      this.messages = [];
      await this.openSession(session.id, { replace: true });
      return session;
    } catch (error) {
      this.showError(error, 'Could not create a session');
      return null;
    }
  }

  async renameSession(sessionID: string, title: string): Promise<void> {
    if (!this.client) return;
    try {
      const updated = await this.client.patch<Session>(this.directoryPath(`/session/${sessionID}`, sessionID), { title });
      this.sessions = this.sessions.map((session) => (session.id === sessionID ? { ...session, ...updated } : session));
    } catch (error) {
      this.showError(error, 'Could not rename session');
    }
  }

  async deleteSession(sessionID: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.delete(this.directoryPath(`/session/${sessionID}`, sessionID));
      this.sessions = this.sessions.filter((session) => session.id !== sessionID);
      this.statuses = Object.fromEntries(Object.entries(this.statuses).filter(([key]) => key !== sessionID));
      if (this.selectedSessionId === sessionID) {
        this.selectedSessionId = null;
        this.messages = [];
        const next = this.sessions[0];
        if (next) await this.openSession(next.id);
      }
    } catch (error) {
      this.showError(error, 'Could not delete session');
    }
  }

  async forkSession(): Promise<void> {
    if (!this.client || !this.selectedSessionId) return;
    try {
      const session = await this.client.post<Session>(this.directoryPath(`/session/${this.selectedSessionId}/fork`), undefined, 30_000);
      this.sessions = [session, ...this.sessions];
      await this.openSession(session.id);
      toast.success('Session forked');
    } catch (error) {
      this.showError(error, 'Could not fork the session');
    }
  }

  async shareSession(): Promise<string | null> {
    if (!this.client || !this.selectedSessionId) return null;
    try {
      const result = await this.client.post<{ url?: string }>(this.directoryPath(`/session/${this.selectedSessionId}/share`), undefined, 30_000);
      const url = result?.url;
      if (url) {
        const ok = await navigator.clipboard.writeText(url).then(() => true).catch(() => false);
        toast[ok ? 'success' : 'info'](ok ? 'Share link copied' : 'Session shared', { description: url });
      }
      return url ?? null;
    } catch (error) {
      this.showError(error, 'Could not share the session');
      return null;
    }
  }

  async summarizeSession(): Promise<void> {
    if (!this.client || !this.selectedSessionId || !this.selectedModel) {
      toast.info('Select a model first');
      return;
    }
    try {
      await this.client.post(
        this.directoryPath(`/session/${this.selectedSessionId}/summarize`),
        { providerID: this.selectedModel.providerID, modelID: this.selectedModel.modelID },
        120_000
      );
      toast.success('Summarizing session');
      this.scheduleMessageRefresh();
    } catch (error) {
      this.showError(error, 'Could not summarize the session');
    }
  }

  async deleteMessage(sessionID: string, messageID: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.delete(this.directoryPath(`/session/${sessionID}/message/${messageID}`, sessionID));
      this.messages = this.messages.filter((message) => message.info.id !== messageID);
    } catch (error) {
      this.showError(error, 'Could not delete message');
    }
  }

  haptic(pattern: number | number[] = 8): void {
    if (!settings.haptics || typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      // Vibration is best-effort.
    }
  }

  async sendPrompt(input: {
    text: string;
    attachments?: Array<{ mime: string; filename?: string; url: string }>;
    agent?: string;
    model?: ModelRef | null;
  }): Promise<boolean> {
    if (!this.client) return false;
    const text = input.text.trim();
    if (!text && !input.attachments?.length) return false;
    let sessionID = this.selectedSessionId;
    if (!sessionID) {
      const session = await this.newSession();
      if (!session) return false;
      sessionID = session.id;
    }
    const agent = input.agent || this.selectedAgent || settings.lastAgent || 'build';
    const model = input.model ?? this.selectedModel;
    if (agent) settings.lastAgent = agent;
    if (model) settings.lastModel = { ...model };
    this.sending = true;
    this.haptic(8);

    try {
      const commandMatch = /^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/.exec(text);
      const shellMatch = /^!([\s\S]+)$/.exec(text);
      if (shellMatch) {
        await this.client.post(
          this.directoryPath(`/session/${sessionID}/shell`, sessionID),
          { agent, command: shellMatch[1], model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined },
          60_000
        );
      } else if (commandMatch && this.commands.some((command) => command.name === commandMatch[1])) {
        await this.client.post(
          this.directoryPath(`/session/${sessionID}/command`, sessionID),
          {
            command: commandMatch[1],
            arguments: commandMatch[2] ?? '',
            agent,
            model: model ? `${model.providerID}/${model.modelID}` : undefined,
            parts: input.attachments?.map((file) => ({ type: 'file', ...file }))
          },
          60_000
        );
      } else {
        const parts: PromptBody['parts'] = [];
        if (text) parts.push({ type: 'text', text });
        for (const file of input.attachments ?? []) parts.push({ type: 'file', ...file });
        const body: PromptBody = { parts, agent };
        if (model) body.model = { providerID: model.providerID, modelID: model.modelID };
        await this.client.post(this.directoryPath(`/session/${sessionID}/prompt_async`, sessionID), body, 60_000);
      }
      this.drafts = { ...this.drafts, [sessionID]: '' };
      this.persistDrafts();
      this.scheduleMessageRefresh();
      return true;
    } catch (error) {
      this.showError(error, 'Could not send prompt');
      return false;
    } finally {
      this.sending = false;
    }
  }

  async abort(): Promise<void> {
    if (!this.client || !this.selectedSessionId) return;
    this.haptic(12);
    try {
      await this.client.post(this.directoryPath(`/session/${this.selectedSessionId}/abort`));
    } catch (error) {
      this.showError(error, 'Could not stop the session');
    }
  }

  async replyPermission(requestID: string, reply: 'once' | 'always' | 'reject'): Promise<void> {
    if (!this.client) return;
    const sessionID = this.permissions.find((request) => request.id === requestID)?.sessionID ?? this.selectedSessionId;
    this.permissions = this.permissions.filter((item) => item.id !== requestID);
    try {
      await this.client.post(this.directoryPath(`/permission/${requestID}/reply`, sessionID), { reply });
    } catch (error) {
      this.showError(error, 'Could not answer the permission request');
      await this.refreshPermissions();
    }
  }

  async replyQuestion(requestID: string, answers: string[][]): Promise<void> {
    if (!this.client) return;
    const sessionID = this.questions.find((request) => request.id === requestID)?.sessionID ?? this.selectedSessionId;
    try {
      await this.client.post(this.requestPath(`/question/${requestID}/reply`, this.requestDirectories.get(requestID) ?? this.requestDirectory(sessionID)), { answers });
      this.resolveQuestion(requestID);
      await this.resync();
    } catch (error) {
      this.showError(error, 'Could not answer the question');
      await this.refreshQuestions();
    }
  }

  async rejectQuestion(requestID: string): Promise<void> {
    if (!this.client) return;
    const sessionID = this.questions.find((request) => request.id === requestID)?.sessionID ?? this.selectedSessionId;
    try {
      await this.client.post(this.requestPath(`/question/${requestID}/reject`, this.requestDirectories.get(requestID) ?? this.requestDirectory(sessionID)));
      this.resolveQuestion(requestID);
      await this.resync();
    } catch (error) {
      this.showError(error, 'Could not dismiss the question');
      await this.refreshQuestions();
    }
  }

  async refreshPermissions(): Promise<void> {
    if (!this.client) return;
    const client = this.client;
    const directory = this.requestDirectory();
    const baseline = this.permissions;
    try {
      const values = await client.get<PermissionRequest[]>(this.requestPath('/permission', directory), 10_000);
      if (client === this.client) this.permissions = this.mergeScopedRequests(this.permissions, values, directory, baseline);
      if (client === this.client) await Promise.all(values.map((request) => this.ensureSession(request.sessionID)));
    } catch {
      // ignore
    }
  }

  async refreshQuestions(): Promise<void> {
    // Question lists are per opencode directory instance. Reconcile background
    // sessions too: their question.asked event may have occurred during an outage.
    const directories = new Set([
      this.requestDirectory(), this.defaultDirectory, ...this.recentDirectories, ...this.knownQuestionDirectories,
      ...this.sessions.map((session) => session.directory), ...this.requestDirectories.values()
    ].filter((directory): directory is string => !!directory).map(trimTrailingSlash));
    const scopes: Array<string | null> = directories.size ? [...directories] : [null];
    // Bound fan-out for hosts with many project directories.
    for (let index = 0; index < scopes.length; index += 4) {
      await Promise.all(scopes.slice(index, index + 4).map((directory) => this.refreshQuestionDirectory(directory)));
    }
  }

  private async refreshQuestionDirectory(directory: string | null): Promise<void> {
    const client = this.client;
    if (!client) return;
    const baseline = this.questions;
    try {
      const values = await client.get<QuestionRequest[]>(this.requestPath('/question', directory), 10_000);
      if (client === this.client) {
        this.questions = this.mergeScopedRequests(this.questions, values, directory, baseline);
        await Promise.all(values.map((request) => this.ensureSession(request.sessionID)));
      }
    } catch {
      // Retain requests on transient failure; the next poll/reconnect retries.
    }
  }

  async loadProviders(): Promise<void> {
    if (!this.client || this.providers || this.providersLoading) return;
    const client = this.client;
    this.providersLoading = true;
    try {
      const response = await client.get<{ all: Provider[] }>(this.directoryPath('/provider'), 45_000);
      if (client === this.client) this.providers = response.all ?? [];
    } catch (error) {
      if (client === this.client) this.showError(error, 'Could not load models');
    } finally {
      if (client === this.client) this.providersLoading = false;
    }
  }

  setAgent(agent: string): void {
    this.selectedAgent = agent;
    settings.lastAgent = agent;
  }

  setModel(model: ModelRef): void {
    this.selectedModel = { ...model };
    settings.lastModel = { ...model };
  }

  setDraft(sessionID: string | null, text: string): void {
    if (!sessionID) return;
    this.drafts = { ...this.drafts, [sessionID]: text };
    this.persistDrafts();
  }

  getDraft(sessionID: string | null): string {
    return sessionID ? (this.drafts[sessionID] ?? '') : '';
  }

  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private persistDrafts(): void {
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => persistentStore.set('drafts', { ...this.drafts }), 400);
  }

  private async loadDrafts(): Promise<void> {
    this.drafts = persistentStore.get<Record<string, string>>('drafts', {});
  }

  private showError(error: unknown, fallback: string): void {
    const message =
      error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : fallback;
    this.lastError = message;
    toast.error(fallback, { description: message });
  }

  private scheduleMessageRefresh(): void {
    if (this.refreshTimer) return;
    const sessionID = this.selectedSessionId;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (sessionID === this.selectedSessionId) void this.refreshMessages(sessionID);
    }, 450);
  }

  private startHealthPolling(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = setInterval(() => void this.pollHealth(), SESSION_POLL_MS);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('online', this.onOnline);
    window.addEventListener('pageshow', this.onVisibility);
  }

  private onVisibility = (): void => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - this.lastEventActivity > STALL_AFTER_MS) this.streamAttempt?.abort();
    void this.pollHealth();
  };

  private onOnline = (): void => {
    if (settings.autoReconnect && this.phase === 'ready') {
      this.startEvents();
      this.startHealthPolling();
      void this.resync();
    }
  };

  async pollHealth(): Promise<void> {
    if (!this.client || this.phase !== 'ready') return;
    const client = this.client;
    const sessionID = this.selectedSessionId;
    const start = performance.now();
    try {
      const health = await client.health();
      if (client !== this.client) return;
      const latency = Math.round(performance.now() - start);
      try {
        const baseline = this.statuses;
        const statuses = await client.get<Record<string, SessionStatus>>(this.directoryPath('/session/status'), 8000);
        if (client === this.client) this.statuses = this.mergeScopedStatuses(statuses, sessionID, baseline);
      } catch {
        // status is optional
      }
      if (client !== this.client) return;
      await Promise.all([this.refreshPermissions(), this.refreshQuestions()]);
      if (client !== this.client) return;
      const busy = Object.values(this.statuses).filter((status) => status.type !== 'idle').length;
      this.connection = {
        state: busy > 0 ? 'online' : 'idle',
        latencyMs: latency,
        version: health.version,
        busySessions: busy,
        checkedAt: Date.now()
      };
    } catch (error) {
      if (client !== this.client) return;
      if (error instanceof ApiError && error.status === 401) {
        this.phase = 'unauthorized';
        this.connection = { state: 'unauthorized', checkedAt: Date.now() };
        return;
      }
      this.connection = { state: 'offline', error: error instanceof Error ? error.message : String(error), checkedAt: Date.now() };
      if (!(error instanceof ApiError)) this.eventState = 'reconnecting';
    }
  }

  private startEvents(): void {
    this.stopEvents();
    const gen = ++this.eventGeneration;
    this.abortEvents = new AbortController();
    void this.runEventLoop(gen, this.abortEvents.signal);
  }

  private stopEvents(): void {
    this.eventGeneration++;
    this.abortEvents?.abort();
    this.abortEvents = null;
    this.streamAttempt = null;
    this.flushTranscript();
    this.messageRequestId++;
    this.initialRequestId++;
    this.initialEvents = null;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.eventState = 'off';
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
      document.removeEventListener('visibilitychange', this.onVisibility);
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('pageshow', this.onVisibility);
    }
  }

  /**
   * Keeps the event stream open. A stream can stop delivering without ending or
   * erroring (a tether restart, a sleeping phone, a stalled upstream), which is why
   * the loop also watches for silence and reconnects instead of waiting forever.
   */
  private async runEventLoop(gen: number, signal: AbortSignal): Promise<void> {
    let backoff = 1000;
    while (gen === this.eventGeneration && !signal.aborted && this.client) {
      this.eventState = this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting';
      const attempt = new AbortController();
      this.streamAttempt = attempt;
      const cancelAttempt = () => attempt.abort();
      signal.addEventListener('abort', cancelAttempt, { once: true });
      let lastFrame = Date.now();
      this.lastEventActivity = lastFrame;
      const watchdog = setInterval(() => void this.checkStalled(attempt, () => lastFrame), STALL_CHECK_MS);
      try {
        const directory = this.selectedSession?.directory;
        const path = this.legacyEvents ? `/event${directory ? `?directory=${encodeURIComponent(directory)}` : ''}` : '/global/event';
        for await (const event of this.client.stream(path, attempt.signal, () => { lastFrame = Date.now(); this.lastEventActivity = lastFrame; })) {
          if (gen !== this.eventGeneration) return;
          lastFrame = Date.now();
          if (this.reconnectAttempt > 0) {
            // Events emitted while the stream was down are gone; reload what they would have changed.
            void this.resync();
          }
          this.eventState = 'live';
          this.reconnectAttempt = 0;
          backoff = 1000;
          this.applyEvent(event);
        }
      } catch (error) {
        if (signal.aborted || gen !== this.eventGeneration) return;
        if (error instanceof ApiError && error.status === 404 && !this.legacyEvents) {
          this.legacyEvents = true;
          continue;
        }
        if (error instanceof ApiError && error.status === 401) {
          this.phase = 'unauthorized';
          this.connection = { state: 'unauthorized' };
          return;
        }
        this.eventState = 'reconnecting';
      } finally {
        clearInterval(watchdog);
        this.flushTranscript();
        if (this.streamAttempt === attempt) this.streamAttempt = null;
        signal.removeEventListener('abort', cancelAttempt);
      }
      if (signal.aborted || gen !== this.eventGeneration) return;
      if (!settings.autoReconnect) {
        this.eventState = 'off';
        return;
      }
      this.eventState = 'reconnecting';
      this.reconnectAttempt++;
      await sleep(backoff * (0.8 + Math.random() * 0.4), signal);
      backoff = Math.min(backoff * 1.8, 20_000);
    }
  }

  /**
   * Called every STALL_CHECK_MS while a stream is open. Silence alone is normal (an agent
   * can think for minutes), so a quiet stream is probed: if the host still answers, wait;
   * if it does not, or nothing has arrived for DEAD_AFTER_MS, drop the stream and reconnect.
   */
  private async checkStalled(attempt: AbortController, lastFrame: () => number): Promise<void> {
    if (attempt.signal.aborted) return;
    const silent = Date.now() - lastFrame();
    if (silent < STALL_AFTER_MS) return;
    if (silent >= DEAD_AFTER_MS) {
      attempt.abort();
      return;
    }
    try {
      await this.client?.health();
    } catch {
      attempt.abort();
    }
  }

  private applyEvent(raw: { type: string; properties?: Record<string, unknown>; payload?: unknown; directory?: string }, replay = false): void {
    const event = (raw.payload && typeof raw.payload === 'object' && 'type' in raw.payload
      ? (raw.payload as { type: string; properties: Record<string, unknown> })
      : raw) as { type: string; properties: Record<string, unknown> };
    const props = event.properties ?? {};
    if (!replay && this.initialEvents && /^(session\.(created|updated|deleted|status)|permission\.|question\.|todo\.updated|session\.diff)/.test(event.type)) {
      this.initialEvents.push(raw as TetherEvent);
    }
    switch (event.type) {
      case 'server.connected':
        this.eventState = 'live';
        return;
      case 'message.updated':
      case 'message.part.updated':
      case 'message.part.delta':
      case 'message.part.removed':
      case 'message.removed':
        this.pendingTranscript.push(event);
        if (!this.transcriptTimer) this.transcriptTimer = setTimeout(() => this.flushTranscript(), 16);
        return;
      case 'session.created':
      case 'session.updated': {
        const info = props.info as Session | undefined;
        if (info) this.upsertSession(info);
        return;
      }
      case 'session.deleted': {
        const id = (props.sessionID as string) ?? (props.info as Session | undefined)?.id;
        if (id) {
          this.sessions = this.sessions.filter((session) => session.id !== id);
          if (this.selectedSessionId === id) this.selectedSessionId = null;
        }
        return;
      }
      case 'session.status': {
        const id = props.sessionID as string;
        if (id) this.statuses = { ...this.statuses, [id]: props.status as SessionStatus };
        return;
      }
      case 'session.idle': {
        const id = props.sessionID as string;
        if (id) this.statuses = { ...this.statuses, [id]: { type: 'idle' } };
        if (id === this.selectedSessionId) this.scheduleMessageRefresh();
        void this.refreshSessions();
        return;
      }
      case 'session.error': {
        const message = this.describeSessionError(props.error);
        this.lastError = message;
        toast.error('Session error', { description: message });
        this.scheduleMessageRefresh();
        return;
      }
      case 'permission.asked':
        if (props.id) {
          const request = props as unknown as PermissionRequest;
          if (raw.directory) this.requestDirectories.set(request.id, raw.directory);
          void this.ensureSession(request.sessionID);
          this.permissions = [request, ...this.permissions.filter((item) => item.id !== request.id)];
          if (!replay && settings.notifications && document.visibilityState === 'hidden') notify('Permission needed', `${request.permission} · ${request.patterns?.join(', ') ?? ''}`);
        }
        return;
      case 'permission.replied':
        this.permissions = this.permissions.filter((item) => item.id !== ((props.requestID ?? props.id) as string));
        return;
      case 'question.asked':
        if (props.id) {
          const request = props as unknown as QuestionRequest;
          // Request IDs are unique; legacy streams can replay an already resolved ask.
          if (this.resolvedRequests.has(request.id)) return;
          if (raw.directory) this.requestDirectories.set(request.id, raw.directory);
          void this.ensureSession(request.sessionID);
          this.questions = [request, ...this.questions.filter((item) => item.id !== request.id)];
          if (!replay && settings.notifications && document.visibilityState === 'hidden') notify('opencode has a question', request.questions?.[0]?.question ?? '');
        }
        return;
      case 'question.replied':
      case 'question.rejected':
        this.resolveQuestion((props.requestID ?? props.id) as string);
        return;
      case 'todo.updated': {
        const id = props.sessionID as string;
        if (id) this.todos = { ...this.todos, [id]: (props.todos as Todo[]) ?? [] };
        return;
      }
      case 'session.diff': {
        const id = props.sessionID as string;
        if (id) this.diffs = { ...this.diffs, [id]: (props.diff as DiffFile[]) ?? [] };
        return;
      }
      case 'session.compacted':
        this.scheduleMessageRefresh();
        return;
      case 'installation.update-available':
        toast.info('opencode update available', { description: String((props as { version?: string }).version ?? '') });
        return;
      default:
        return;
    }
  }

  private describeSessionError(error: unknown): string {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    const value = error as { name?: string; data?: { message?: string }; message?: string };
    return value.data?.message ?? value.message ?? value.name ?? 'Session failed';
  }

  private upsertSession(info: Session): void {
    if (info.directory) this.knownQuestionDirectories.add(info.directory);
    const index = this.sessions.findIndex((session) => session.id === info.id);
    const next = index === -1 ? [info, ...this.sessions] : this.sessions.map((session, i) => (i === index ? { ...session, ...info } : session));
    this.sessions = next.sort((a, b) => sessionUpdated(b) - sessionUpdated(a));
  }

  private flushTranscript(): void {
    if (this.transcriptTimer) clearTimeout(this.transcriptTimer);
    this.transcriptTimer = null;
    const events = this.pendingTranscript;
    this.pendingTranscript = [];
    const previous = this.messages;
    this.messages = updateTranscript(previous, events, this.selectedSessionId);
    if (settings.notifications && document.visibilityState === 'hidden' && this.messages !== previous) {
      const completed = new Set(previous.filter((message) => message.info.time.completed).map((message) => message.info.id));
      if (this.messages.some((message) => message.info.role === 'assistant' && message.info.time.completed && !completed.has(message.info.id))) {
        notify('opencode finished', this.selectedSession?.title ?? 'Response ready');
      }
    }
    if (events.some((event) => {
      const props = event.properties ?? {};
      const part = props.part as Part | undefined;
      if ((props.sessionID ?? part?.sessionID) !== this.selectedSessionId) return false;
      if (event.type !== 'message.part.updated' && event.type !== 'message.part.delta') return false;
      const message = this.messages.find((message) => message.info.id === (props.messageID ?? part?.messageID));
      return !message || (event.type === 'message.part.delta' && !message.parts.some((part) => part.id === props.partID));
    })) this.scheduleMessageRefresh();
  }

  private resync(): Promise<void> {
    if (!this.syncInFlight) {
      this.syncInFlight = this.refreshAll().finally(() => { this.syncInFlight = null; });
    }
    return this.syncInFlight;
  }

  async logoutHost(): Promise<void> {
    await this.client?.logoutHost().catch(() => undefined);
    this.stopEvents();
    this.hostAuth = null;
    this.client = null;
    persistentStore.set('hostAuth', null);
    try {
      localStorage.removeItem('opencode-tether.host');
    } catch {
      // ignore
    }
    this.phase = 'host-login';
    this.messages = [];
    this.sessions = [];
    this.resetDirectoryBrowser();
  }

  async disconnect(): Promise<void> {
    this.stopEvents();
    this.client = null;
    this.phase = settings.remotes.length ? 'needs-remote' : 'needs-remote';
    this.selectedSessionId = null;
    this.messages = [];
    this.connection = { state: 'unknown' };
    this.resetDirectoryBrowser();
  }

  async refreshAll(): Promise<void> {
    await Promise.all([
      this.refreshInitial(),
      this.refreshMessages(),
      this.selectedSessionId ? this.refreshTodos(this.selectedSessionId) : Promise.resolve(),
      this.selectedSessionId ? this.refreshDiffs(this.selectedSessionId) : Promise.resolve()
    ]);
  }
}

export const app = new AppState();
