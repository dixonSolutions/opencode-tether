import { persistentStore } from '$lib/storage.svelte';
import { app } from '$lib/state/app.svelte';
import { tick } from 'svelte';

declare global {
  interface Window { __TETHER_UPDATE_TRIAL__?: string; }
}

export function installLiveUpdates(): () => void {
  const send = (action: string, extra: Record<string, string> = {}) => window.AndySU?.postMessage(JSON.stringify({ action, ...extra }));
  const beforeApply = async () => {
    // Include an in-flight draft whose normal debounce has not fired yet.
    persistentStore.set('drafts', { ...app.drafts });
    await tick();
    try {
      await persistentStore.flush();
      send('reloadWeb');
    } catch { send('abortWeb'); }
  };
  window.addEventListener('andysu-before-apply', beforeApply);
  // A ready screen proves that the new bundle booted and recovered persisted state.
  const ready = () => send('webReady', { token: window.__TETHER_UPDATE_TRIAL__ ?? '' });
  const stop = appReady(ready);
  return () => { stop(); window.removeEventListener('andysu-before-apply', beforeApply); };
}

function appReady(ready: () => void) {
  let sent = false;
  return $effect.root(() => {
    $effect(() => {
      if (!sent && app.phase !== 'boot' && app.phase !== 'connecting') {
        sent = true;
        requestAnimationFrame(ready);
      }
    });
  });
}
