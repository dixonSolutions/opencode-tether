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
  private writing: Promise<void> = Promise.resolve();
  private dirty = new Set<string>();
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
    this.dirty.add(key);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { void this.flush().catch(() => undefined); }, 250);
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const keys = [...this.dirty];
    this.dirty.clear();
    if (!keys.length) return this.writing;
    // Snapshot only in the delayed persistence task, never inside a toggle handler.
    const snapshot = JSON.parse(JSON.stringify(this.memory)) as Json;
    this.writing = this.writing.catch(() => undefined).then(async () => {
      try {
        if (this.nativeStore) {
          for (const key of keys) await this.nativeStore.set(key, snapshot[key]);
          await this.nativeStore.save();
        } else {
          localStorage.setItem('opencode-tether.store.v1', JSON.stringify(snapshot));
        }
      } catch (error) {
        keys.forEach(key => this.dirty.add(key));
        console.warn('Failed to persist settings', error);
        throw error;
      }
    });
    return this.writing;
  }

  async reset(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.writing;
    this.dirty.clear();
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
