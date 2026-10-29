export function isTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

export async function initPlatformClasses(): Promise<void> {
  if (typeof document === 'undefined') return;
  if (isTauri()) document.documentElement.classList.add('is-tauri');
  if (await isAndroid()) document.documentElement.classList.add('is-android');
  if (await isFlatpak()) document.documentElement.classList.add('is-flatpak');
}

export async function isAndroid(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)) return true;
  if (!isTauri()) return false;
  try {
    const { type } = await import('@tauri-apps/plugin-os');
    return (await type()) === 'android';
  } catch {
    return false;
  }
}

export async function isFlatpak(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('is_flatpak');
  } catch {
    return false;
  }
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isCoarsePointer(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (isTauri()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch {
      // fall through to browser
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function copyText(text: string): Promise<boolean> {
  if (isTauri()) {
    try {
      const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
      await writeText(text);
      return true;
    } catch {
      // fall through
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function notify(title: string, body: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: '/icon-192.png', tag: 'opencode-tether' });
  } catch {
    // Notifications are best-effort.
  }
}

export function relativeTime(ts: number | undefined): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 45_000) return 'now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
  if (diff < 604_800_000) return `${Math.round(diff / 86_400_000)}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatCost(cost: number | undefined): string {
  if (!cost) return '';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatTokens(n: number | undefined): string {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

export function projectName(path: string | undefined): string {
  if (!path) return '';
  const clean = path.replace(/\/+$/, '');
  return clean.split('/').pop() || clean;
}
