import type { Remote } from '$lib/api/types';
import { normalizeBaseUrl } from '$lib/api/client';
import { persistentStore } from '$lib/storage.svelte';

export type ThemeMode = 'dark' | 'light' | 'system';
export type SendKey = 'enter' | 'mod-enter';

export interface ModelRef {
  providerID: string;
  modelID: string;
}

export interface SettingsData {
  remotes: Remote[];
  defaultRemoteId: string | null;
  lastRemoteId: string | null;
  theme: ThemeMode;
  showReasoning: boolean;
  showToolDetails: boolean;
  showTimestamps: boolean;
  sendKey: SendKey;
  notifications: boolean;
  autoReconnect: boolean;
  autoScroll: boolean;
  compact: boolean;
  haptics: boolean;
  favorites: string[];
  lastAgent: string;
  lastModel: ModelRef | null;
}

const DEFAULTS: SettingsData = {
  remotes: [],
  defaultRemoteId: null,
  lastRemoteId: null,
  theme: 'dark',
  showReasoning: false,
  showToolDetails: false,
  showTimestamps: false,
  sendKey: 'enter',
  notifications: true,
  autoReconnect: true,
  autoScroll: true,
  compact: false,
  haptics: true,
  favorites: [],
  lastAgent: 'build',
  lastModel: null
};

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

class SettingsState {
  remotes = $state<Remote[]>([]);
  defaultRemoteId = $state<string | null>(null);
  lastRemoteId = $state<string | null>(null);
  theme = $state<ThemeMode>('dark');
  showReasoning = $state(false);
  showToolDetails = $state(false);
  showTimestamps = $state(false);
  sendKey = $state<SendKey>('enter');
  notifications = $state(true);
  autoReconnect = $state(true);
  autoScroll = $state(true);
  compact = $state(false);
  haptics = $state(true);
  favorites = $state<string[]>([]);
  lastAgent = $state('build');
  lastModel = $state<ModelRef | null>(null);
  hydrated = $state(false);

  async init(): Promise<void> {
    await persistentStore.load();
    const saved = persistentStore.get<Partial<SettingsData>>('settings', {});
    for (const key of Object.keys(DEFAULTS) as (keyof SettingsData)[]) {
      const value = saved[key];
      if (value !== undefined) (this as unknown as Record<string, unknown>)[key] = value;
    }
    this.remotes = (saved.remotes ?? []).map((remote) => ({ ...remote, url: normalizeBaseUrl(remote.url) }));
    if (this.remotes.length > 0 && !this.remotes.some((remote) => remote.id === this.defaultRemoteId)) {
      this.defaultRemoteId = this.remotes[0].id;
    }
    this.hydrated = true;
    $effect.root(() => {
      $effect(() => {
        const snapshot: SettingsData = {
          remotes: this.remotes.map((remote) => ({ ...remote })),
          defaultRemoteId: this.defaultRemoteId,
          lastRemoteId: this.lastRemoteId,
          theme: this.theme,
          showReasoning: this.showReasoning,
          showToolDetails: this.showToolDetails,
          showTimestamps: this.showTimestamps,
          sendKey: this.sendKey,
          notifications: this.notifications,
          autoReconnect: this.autoReconnect,
          autoScroll: this.autoScroll,
          compact: this.compact,
          haptics: this.haptics,
          favorites: [...this.favorites],
          lastAgent: this.lastAgent,
          lastModel: this.lastModel ? { ...this.lastModel } : null
        };
        persistentStore.set('settings', snapshot);
      });
    });
  }

  get defaultRemote(): Remote | undefined {
    return this.remotes.find((remote) => remote.id === this.defaultRemoteId) ?? this.remotes[0];
  }

  get lastRemote(): Remote | undefined {
    return (
      this.remotes.find((remote) => remote.id === this.lastRemoteId) ??
      this.remotes.find((remote) => remote.id === this.defaultRemoteId) ??
      this.remotes[0]
    );
  }

  addRemote(input: Omit<Remote, 'id' | 'createdAt' | 'kind'> & { id?: string; kind?: Remote['kind'] }): Remote {
    const remote: Remote = {
      ...input,
      id: input.id ?? uid(),
      kind: input.kind ?? 'remote',
      url: normalizeBaseUrl(input.url),
      createdAt: Date.now(),
      lastUsedAt: Date.now()
    };
    this.remotes = [...this.remotes, remote];
    if (!this.defaultRemoteId) this.defaultRemoteId = remote.id;
    this.lastRemoteId = remote.id;
    return remote;
  }

  updateRemote(id: string, patch: Partial<Omit<Remote, 'id' | 'createdAt'>>): void {
    this.remotes = this.remotes.map((remote) =>
      remote.id === id
        ? { ...remote, ...patch, url: patch.url ? normalizeBaseUrl(patch.url) : remote.url }
        : remote
    );
  }

  removeRemote(id: string): void {
    this.remotes = this.remotes.filter((remote) => remote.id !== id);
    if (this.defaultRemoteId === id) this.defaultRemoteId = this.remotes[0]?.id ?? null;
    if (this.lastRemoteId === id) this.lastRemoteId = this.defaultRemoteId;
  }

  setDefault(id: string): void {
    this.defaultRemoteId = id;
  }

  touchRemote(id: string): void {
    this.lastRemoteId = id;
    this.remotes = this.remotes.map((remote) => (remote.id === id ? { ...remote, lastUsedAt: Date.now() } : remote));
  }

  toggleFavoriteModel(key: string): void {
    this.favorites = this.favorites.includes(key) ? this.favorites.filter((item) => item !== key) : [...this.favorites, key];
  }

  setTheme(theme: ThemeMode): void {
    this.theme = theme;
  }
}

export const settings = new SettingsState();
