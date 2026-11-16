// The AndySU update host's bridge (MainActivity.kt: window.AndySU). It exists only when the app
// runs under an AndySU host on Android; everywhere else `andysuAvailable()` is false and the
// Updates tab keeps the plain-build content.

import { writable } from 'svelte/store';

export interface AndyStatus {
  state?: string;
  runningVersion?: string;
  liveAppliedVersion?: string;
  release?: string;
  percent?: number;
}

interface Bridge {
  postMessage(message: string): void;
  onmessage: ((event: MessageEvent<string>) => void) | null;
}

declare global {
  interface Window {
    AndySU?: Bridge;
  }
}

export const andysuStatus = writable<AndyStatus>({});

const bridge = () => (typeof window === 'undefined' ? undefined : window.AndySU);
let mode = 'auto';
let modeChanged = false;
let connectedBridge: Bridge | undefined;
let modeListener: ((mode: string) => void) | undefined;

function send(action: string, extra: Record<string, string> = {}): void {
  try {
    bridge()?.postMessage(JSON.stringify({ action, ...extra }));
  } catch {
    /* Bridge unavailable. */
  }
}

function connect(): void {
  const current = bridge();
  if (!current || current === connectedBridge) return;
  connectedBridge = current;
  current.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'init') {
        if (!modeChanged) mode = message.mode === 'off' ? 'off' : 'auto';
        modeListener?.(mode);
      }
      if ((message.type === 'init' || message.type === 'status') && message.status) andysuStatus.set(message.status as AndyStatus);
    } catch {
      /* Ignore malformed messages. */
    }
  };
  send('init');
}

export function andysuAvailable(): boolean {
  try {
    connect();
    return typeof bridge()?.postMessage === 'function';
  } catch {
    return false;
  }
}

const upToDate = (s: AndyStatus) => s.state === 'up_to_date' || (s.state === 'staged' && !!s.release && s.release === s.runningVersion);

/** One plain-language line. "Up to date" only after a check that really said so. */
export function statusText(s: AndyStatus): string {
  if (upToDate(s)) return s.liveAppliedVersion && s.liveAppliedVersion === s.runningVersion ? 'Update applied live' : 'Up to date';
  switch (s.state) {
    case 'checking':
      return 'Checking for updates…';
    case 'downloading':
      return `Downloading update${typeof s.percent === 'number' ? ` · ${Math.max(0, Math.min(100, Math.round(s.percent)))}%` : '…'}`;
    case 'staged':
      return 'Update ready · applying automatically (screen may reload)';
    case 'applying':
      return 'Applying update…';
    case 'shell_update':
      return 'This update needs a new app install';
    case 'error':
      return 'Couldn’t check for updates · will try again';
    case 'deferred':
      return 'Update check postponed · will try again';
    case 'available':
      return 'Update available';
    default:
      return 'Updates haven’t been checked yet';
  }
}

/** The button to show beside the status, or null when there is nothing to act on. */
export function applyAction(s: AndyStatus): 'Install' | 'Apply now' | null {
  if (s.state === 'shell_update') return 'Install';
  if (s.state === 'staged' && !upToDate(s)) return 'Apply now';
  return null;
}

/** Checking is pointless while a check, download or apply is already under way. */
export function canCheck(s: AndyStatus): boolean {
  return !['checking', 'downloading', 'applying'].includes(s.state ?? '');
}

export function initAndySU(onMode?: (mode: string) => void): () => void {
  modeListener = onMode;
  connect();
  send('status');
  return () => {
    if (modeListener === onMode) modeListener = undefined;
  };
}

export function andysuMode(): string {
  connect();
  return mode;
}

export function setAndySUMode(value: 'auto' | 'off'): void {
  modeChanged = true;
  mode = value;
  send('setMode', { mode: value });
}

export const checkAndySU = () => send('checkNow');
export const applyAndySU = () => send('applyNow');
