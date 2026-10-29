import { ApiError, OpencodeClient, normalizeBaseUrl } from '$lib/api/client';
import type {
  Agent,
  Command,
  Config,
  DiffFile,
  HostInfo,
  MessageInfo,
  MessageWithParts,
  Model,
  Part,
  PermissionRequest,
  Project,
  PromptBody,
  Provider,
  QuestionRequest,
  Remote,
  RemoteHealth,
  Session,
  SessionStatus,
  SnapshotFileDiff,
  Todo
} from '$lib/api/types';
import { initPlatformClasses, notify, isTauri } from '$lib/platform';
import { persistentStore } from '$lib/storage.svelte';
import { settings, type ModelRef } from './settings.svelte';
import { toast } from 'svelte-sonner';
import { setMode } from 'mode-watcher';

export type Phase = 'boot' | 'needs-remote' | 'host-login' | 'connecting' | 'ready' | 'offline' | 'unauthorized' | 'error';
export type EventState = 'off' | 'connecting' | 'live' | 'reconnecting';

const SESSION_POLL_MS = 20_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
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

export class AppState {
  phase = $state<Phase>('boot');
  eventState = $state<EventState>('off');
  hostMode = $state(false);
  host = $state<HostInfo | null>(null);
  activeRemote = $state<Remote | null>(null);
  connection = $state<RemoteHealth>({ state: 'unknown' });

  sessions = $state<Session[]>([]);
  projects = $state<Project[]>([]);
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
  lastError = $state<string | null>(null);
  search = $state('');
  drafts = $state<Record<string, string>>({});
  selectedAgent = $state('build');
  selectedModel = $state<ModelRef | null>(null);
  hostAuth = $state<{ username: string; password: string } | null>(null);
  booted = $state(false);

  client: OpencodeClient | null = null;
  private abortEvents: AbortController | null = null;
  private eventGeneration = 0;
  private messageRequestId = 0;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private lastRefresh = 0;
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
    if (!query) return this.sessions;
    return this.sessions.filter(
      (session) =>
        (session.title ?? '').toLowerCase().includes(query) ||
        (session.directory ?? '').toLowerCase().includes(query) ||
        (session.slug ?? '').toLowerCase().includes(query)
    );
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
    try {
      const started = performance.now();
      const health = await client.health();
      this.connection = { state: 'idle', version: health.version, latencyMs: Math.round(performance.now() - started), checkedAt: Date.now() };
      settings.touchRemote(remote.id);
      await this.afterConnect();
    } catch (error) {
      this.handleConnectError(error, remote);
    }
  }

  async connectHost(username: string, password: string): Promise<void> {
    this.connection = { state: 'checking' };
    this.phase = 'connecting';
    this.lastError = null;
    this.stopEvents();
    const basic = new OpencodeClient(window.location.origin, { username, password });
    this.client = basic;
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
    this.phase = 'ready';
    this.eventState = 'connecting';
    this.reconnectAttempt = 0;
    this.startEvents();
    this.startHealthPolling();
    await this.refreshInitial();
    void this.pollHealth();
    const key = this.activeRemote ? `lastSession:${this.activeRemote.id}` : 'hostLastSession';
    const savedSession = persistentStore.get<string | null>(key, null);
    const deepLink = new URLSearchParams(window.location.search).get('session');
    const target =
      this.sessions.find((session) => session.id === deepLink) ??
      this.sessions.find((session) => session.id === savedSession) ??
      this.sessions[0];
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
    await this.connect(remote);
  }

  async refreshInitial(): Promise<void> {
    if (!this.client) return;
    this.sessionsLoading = true;
    const results = await Promise.allSettled([
      this.client.get<Session[]>('/session', 20_000),
      this.client.get<Agent[]>('/agent', 15_000),
      this.client.get<Command[]>('/command', 15_000),
      this.client.get<Config>('/config', 15_000),
      this.client.get<Project[]>('/project', 15_000),
      this.client.get<Record<string, SessionStatus>>('/session/status', 15_000)
    ]);
    const [sessions, agents, commands, config, projects, statuses] = results;
    if (sessions.status === 'fulfilled') this.sessions = [...sessions.value].sort((a, b) => sessionUpdated(b) - sessionUpdated(a));
    if (agents.status === 'fulfilled') this.agents = agents.value;
    if (commands.status === 'fulfilled') this.commands = commands.value.filter((command) => command.name);
    if (config.status === 'fulfilled') this.config = config.value;
    if (projects.status === 'fulfilled') this.projects = projects.value;
    if (statuses.status === 'fulfilled') this.statuses = { ...statuses.value };

    const configModel = parseModel(typeof this.config?.model === 'string' ? this.config.model : undefined);
    this.selectedModel = settings.lastModel ?? configModel ?? null;
    this.selectedAgent = this.selectedAgent || settings.lastAgent || 'build';

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
    try {
      const sessions = await this.client.get<Session[]>('/session', 20_000);
      this.sessions = [...sessions].sort((a, b) => sessionUpdated(b) - sessionUpdated(a));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) this.phase = 'unauthorized';
    }
  }

  async openSession(sessionID: string, options: { replace?: boolean } = {}): Promise<void> {
    if (!this.client) return;
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
    if (session?.model) this.selectedModel = { providerID: session.model.providerID, modelID: session.model.id };
    await Promise.all([this.refreshMessages(sessionID), this.refreshTodos(sessionID), this.refreshDiffs(sessionID)]);
  }

  async refreshMessages(sessionID = this.selectedSessionId): Promise<void> {
    if (!this.client || !sessionID) return;
    const gen = ++this.messageRequestId;
    this.messagesLoading = true;
    try {
      const messages = await this.client.get<MessageWithParts[]>(`/session/${sessionID}/message`, 30_000);
      if (gen === this.messageRequestId && sessionID === this.selectedSessionId) {
        this.messages = [...messages].sort((a, b) => (a.info.time?.created ?? 0) - (b.info.time?.created ?? 0));
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) this.phase = 'unauthorized';
    } finally {
      if (gen === this.messageRequestId) this.messagesLoading = false;
    }
  }

  async refreshTodos(sessionID = this.selectedSessionId): Promise<void> {
    if (!this.client || !sessionID) return;
    try {
      const todos = await this.client.get<Todo[]>(`/session/${sessionID}/todo`, 10_000);
      this.todos = { ...this.todos, [sessionID]: todos };
    } catch {
      // Todos are optional.
    }
  }

  async refreshDiffs(sessionID = this.selectedSessionId): Promise<void> {
    if (!this.client || !sessionID) return;
    try {
      const diffs = await this.client.get<DiffFile[]>(`/session/${sessionID}/diff`, 15_000);
      this.diffs = { ...this.diffs, [sessionID]: diffs };
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
      const session = await this.client.post<Session>('/session', body, 30_000);
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
      const updated = await this.client.patch<Session>(`/session/${sessionID}`, { title });
      this.sessions = this.sessions.map((session) => (session.id === sessionID ? { ...session, ...updated } : session));
    } catch (error) {
      this.showError(error, 'Could not rename session');
    }
  }

  async deleteSession(sessionID: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.delete(`/session/${sessionID}`);
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
      const session = await this.client.post<Session>(`/session/${this.selectedSessionId}/fork`, undefined, 30_000);
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
      const result = await this.client.post<{ url?: string }>(`/session/${this.selectedSessionId}/share`, undefined, 30_000);
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
        `/session/${this.selectedSessionId}/summarize`,
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
      await this.client.delete(`/session/${sessionID}/message/${messageID}`);
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
          `/session/${sessionID}/shell`,
          { agent, command: shellMatch[1], model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined },
          60_000
        );
      } else if (commandMatch && this.commands.some((command) => command.name === commandMatch[1])) {
        await this.client.post(
          `/session/${sessionID}/command`,
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
        await this.client.post(`/session/${sessionID}/prompt_async`, body, 60_000);
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
      await this.client.post(`/session/${this.selectedSessionId}/abort`);
    } catch (error) {
      this.showError(error, 'Could not stop the session');
    }
  }

  async replyPermission(requestID: string, reply: 'once' | 'always' | 'reject'): Promise<void> {
    if (!this.client) return;
    this.permissions = this.permissions.filter((item) => item.id !== requestID);
    try {
      await this.client.post(`/permission/${requestID}/reply`, { reply });
    } catch (error) {
      this.showError(error, 'Could not answer the permission request');
      await this.refreshPermissions();
    }
  }

  async replyQuestion(requestID: string, answers: string[][]): Promise<void> {
    if (!this.client) return;
    this.questions = this.questions.filter((item) => item.id !== requestID);
    try {
      await this.client.post(`/question/${requestID}/reply`, { answers });
    } catch (error) {
      this.showError(error, 'Could not answer the question');
      await this.refreshQuestions();
    }
  }

  async rejectQuestion(requestID: string): Promise<void> {
    if (!this.client) return;
    this.questions = this.questions.filter((item) => item.id !== requestID);
    try {
      await this.client.post(`/question/${requestID}/reject`);
    } catch (error) {
      this.showError(error, 'Could not dismiss the question');
      await this.refreshQuestions();
    }
  }

  async refreshPermissions(): Promise<void> {
    if (!this.client) return;
    try {
      this.permissions = await this.client.get<PermissionRequest[]>('/permission', 10_000);
    } catch {
      // ignore
    }
  }

  async refreshQuestions(): Promise<void> {
    if (!this.client) return;
    try {
      this.questions = await this.client.get<QuestionRequest[]>('/question', 10_000);
    } catch {
      // ignore
    }
  }

  async loadProviders(): Promise<void> {
    if (!this.client || this.providers || this.providersLoading) return;
    this.providersLoading = true;
    try {
      const response = await this.client.get<{ all: Provider[] }>('/provider', 45_000);
      this.providers = response.all ?? [];
    } catch (error) {
      this.showError(error, 'Could not load models');
    } finally {
      this.providersLoading = false;
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
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refreshMessages(), 450);
  }

  private startHealthPolling(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = setInterval(() => void this.pollHealth(), SESSION_POLL_MS);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility = (): void => {
    if (document.visibilityState === 'visible') void this.pollHealth();
  };

  async pollHealth(): Promise<void> {
    if (!this.client || this.phase !== 'ready') return;
    const start = performance.now();
    try {
      const health = await this.client.health();
      const latency = Math.round(performance.now() - start);
      try {
        const statuses = await this.client.get<Record<string, SessionStatus>>('/session/status', 8000);
        this.statuses = { ...statuses };
      } catch {
        // status is optional
      }
      const busy = Object.values(this.statuses).filter((status) => status.type !== 'idle').length;
      this.connection = {
        state: busy > 0 ? 'online' : 'idle',
        latencyMs: latency,
        version: health.version,
        busySessions: busy,
        checkedAt: Date.now()
      };
      if (this.eventState === 'reconnecting') this.eventState = 'live';
    } catch (error) {
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
    this.eventState = 'off';
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
  }

  private async runEventLoop(gen: number, signal: AbortSignal): Promise<void> {
    let backoff = 1000;
    while (gen === this.eventGeneration && !signal.aborted && this.client) {
      this.eventState = this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting';
      try {
        for await (const event of this.client.stream('/event', signal)) {
          if (gen !== this.eventGeneration) return;
          this.eventState = 'live';
          this.reconnectAttempt = 0;
          backoff = 1000;
          this.applyEvent(event);
        }
      } catch (error) {
        if (signal.aborted || gen !== this.eventGeneration) return;
        if (error instanceof ApiError && error.status === 401) {
          this.phase = 'unauthorized';
          this.connection = { state: 'unauthorized' };
          return;
        }
        this.eventState = 'reconnecting';
      }
      if (signal.aborted || gen !== this.eventGeneration) return;
      if (!settings.autoReconnect) {
        this.eventState = 'off';
        return;
      }
      this.reconnectAttempt++;
      await sleep(backoff, signal);
      backoff = Math.min(backoff * 1.8, 20_000);
    }
  }

  private applyEvent(raw: { type: string; properties?: Record<string, unknown>; payload?: unknown }): void {
    const event = (raw.payload && typeof raw.payload === 'object' && 'type' in raw.payload
      ? (raw.payload as { type: string; properties: Record<string, unknown> })
      : raw) as { type: string; properties: Record<string, unknown> };
    const props = event.properties ?? {};
    switch (event.type) {
      case 'server.connected':
        this.eventState = 'live';
        return;
      case 'message.updated': {
        const info = props.info as MessageInfo | undefined;
        if (info) this.upsertMessage(info);
        return;
      }
      case 'message.part.updated': {
        const part = props.part as Part | undefined;
        if (part) this.upsertPart(part);
        return;
      }
      case 'message.part.removed': {
        const messageID = props.messageID as string;
        const partID = props.partID as string;
        this.messages = this.messages.map((message) =>
          message.info.id === messageID ? { ...message, parts: message.parts.filter((part) => part.id !== partID) } : message
        );
        return;
      }
      case 'message.removed': {
        this.messages = this.messages.filter((message) => message.info.id !== (props.messageID as string));
        return;
      }
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
          this.permissions = [request, ...this.permissions.filter((item) => item.id !== request.id)];
          if (settings.notifications && document.visibilityState === 'hidden') notify('Permission needed', `${request.permission} · ${request.patterns?.join(', ') ?? ''}`);
        }
        return;
      case 'permission.replied':
        this.permissions = this.permissions.filter((item) => item.id !== (props.id as string));
        return;
      case 'question.asked':
        if (props.id) {
          const request = props as unknown as QuestionRequest;
          this.questions = [request, ...this.questions.filter((item) => item.id !== request.id)];
          if (settings.notifications && document.visibilityState === 'hidden') notify('opencode has a question', request.questions?.[0]?.question ?? '');
        }
        return;
      case 'question.replied':
      case 'question.rejected':
        this.questions = this.questions.filter((item) => item.id !== (props.id as string));
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
    const index = this.sessions.findIndex((session) => session.id === info.id);
    const next = index === -1 ? [info, ...this.sessions] : this.sessions.map((session, i) => (i === index ? { ...session, ...info } : session));
    this.sessions = next.sort((a, b) => sessionUpdated(b) - sessionUpdated(a));
  }

  private upsertMessage(info: MessageInfo): void {
    if (this.selectedSessionId && info.sessionID !== this.selectedSessionId) return;
    const index = this.messages.findIndex((message) => message.info.id === info.id);
    if (index === -1) {
      this.messages = [...this.messages, { info, parts: [] }].sort((a, b) => (a.info.time?.created ?? 0) - (b.info.time?.created ?? 0));
    } else {
      this.messages = this.messages.map((message, i) => (i === index ? { ...message, info: { ...message.info, ...info } } : message));
    }
    if (settings.notifications && info.role === 'assistant' && info.time?.completed && document.visibilityState === 'hidden') {
      notify('opencode finished', this.selectedSession?.title ?? 'Response ready');
    }
  }

  private upsertPart(part: Part): void {
    if (this.selectedSessionId && part.sessionID !== this.selectedSessionId) return;
    let found = false;
    const next = this.messages.map((message) => {
      if (message.info.id !== part.messageID) return message;
      found = true;
      const index = message.parts.findIndex((item) => item.id === part.id);
      const parts = index === -1 ? [...message.parts, part] : message.parts.map((item, i) => (i === index ? part : item));
      return { ...message, parts };
    });
    if (found) {
      this.messages = next;
    } else if (part.sessionID === this.selectedSessionId) {
      this.scheduleMessageRefresh();
    }
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
  }

  async disconnect(): Promise<void> {
    this.stopEvents();
    this.client = null;
    this.phase = settings.remotes.length ? 'needs-remote' : 'needs-remote';
    this.selectedSessionId = null;
    this.messages = [];
    this.connection = { state: 'unknown' };
  }

  async refreshAll(): Promise<void> {
    await this.refreshInitial();
    if (this.selectedSessionId) await this.refreshMessages(this.selectedSessionId);
    await Promise.all([this.refreshPermissions(), this.refreshQuestions()]);
  }
}

export const app = new AppState();
