import { isTauri } from './platform';

type Json = Record<string, unknown>;

class PersistentStore {
  private nativeStore: {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    save(): Promise<void>;
    clear(): Promise<void>;
  } | null = null;
  private loaded = false;
  private memory: Json = {};
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (isTauri()) {
      try {
        const { load } = await import('@tauri-apps/plugin-store');
        const store = await load('tether-settings.json', { autoSave: false, defaults: {} });
        this.nativeStore = {
          get: <T>(key: string) => store.get<T>(key),
          set: (key: string, value: unknown) => store.set(key, value),
          save: () => store.save(),
          clear: () => store.clear()
        };
        const all = await store.entries();
        this.memory = Object.fromEntries(all) as Json;
        return;
      } catch (error) {
        console.warn('Native store unavailable, falling back to localStorage', error);
      }
    }
    try {
      const raw = localStorage.getItem('opencode-tether.store.v1');
      if (raw) this.memory = JSON.parse(raw) as Json;
    } catch {
      this.memory = {};
    }
  }

  get<T>(key: string, fallback: T): T {
    return (this.memory[key] as T | undefined) ?? fallback;
  }

  set(key: string, value: unknown): void {
    this.memory[key] = value;
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), 250);
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.nativeStore) {
      try {
        for (const [key, value] of Object.entries(this.memory)) await this.nativeStore.set(key, value);
        await this.nativeStore.save();
      } catch (error) {
        console.warn('Failed to persist native settings', error);
      }
      return;
    }
    try {
      localStorage.setItem('opencode-tether.store.v1', JSON.stringify(this.memory));
    } catch (error) {
      console.warn('Failed to persist settings', error);
    }
  }

  async reset(): Promise<void> {
    this.memory = {};
    if (this.nativeStore) {
      try {
        await this.nativeStore.clear();
        await this.nativeStore.save();
      } catch {
        // ignore
      }
    } else {
      localStorage.removeItem('opencode-tether.store.v1');
    }
  }
}

export const persistentStore = new PersistentStore();
