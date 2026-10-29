<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/state/app.svelte';
  import { settings } from '$lib/state/settings.svelte';
  import Brand from '$lib/components/tether/Brand.svelte';
  import Onboarding from '$lib/components/tether/Onboarding.svelte';
  import HostLogin from '$lib/components/tether/HostLogin.svelte';
  import Workspace from '$lib/components/tether/Workspace.svelte';
  import ConnectionError from '$lib/components/tether/ConnectionError.svelte';

  onMount(() => {
    void app.boot();
  });

  $effect(() => {
    if (settings.hydrated && settings.theme && document.documentElement) {
      // ModeWatcher owns the class; this keeps the theme-color metadata in sync.
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0a0a' : '#faf8f6');
    }
  });
</script>

{#if app.phase === 'boot'}
  <div class="app-height relative grid place-items-center overflow-hidden bg-background">
    <div class="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_top,rgba(250,178,131,0.12),transparent_65%)]"></div>
    <div class="flex flex-col items-center">
      <div class="relative">
        <Brand size={64} />
        <span class="absolute -inset-3 -z-10 rounded-[28px] bg-tether/10 blur-xl"></span>
      </div>
      <div class="mt-4 flex items-center gap-1.5">
        <span class="size-1 animate-bounce rounded-full bg-tether/80 [animation-delay:-0.3s]"></span>
        <span class="size-1 animate-bounce rounded-full bg-tether/80 [animation-delay:-0.15s]"></span>
        <span class="size-1 animate-bounce rounded-full bg-tether/80"></span>
      </div>
      <div class="mt-2 text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground/50">starting tether</div>
    </div>
  </div>
{:else if app.phase === 'connecting'}
  <div class="app-height relative grid place-items-center overflow-hidden bg-background">
    <div class="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_top,rgba(250,178,131,0.12),transparent_65%)]"></div>
    <div class="flex max-w-xs flex-col items-center px-6 text-center">
      <Brand size={56} />
      <div class="mt-4 flex items-center gap-2 text-[12px] font-medium">
        <span class="size-1.5 animate-pulse rounded-full bg-tether"></span>
        Connecting
      </div>
      <div class="mt-1 truncate text-[10px] text-muted-foreground/60">
        {app.hostMode ? 'this host' : (app.activeRemote?.name ?? '')}
      </div>
      <div class="mt-0.5 max-w-full truncate font-mono text-[9px] text-muted-foreground/40">
        {app.hostMode ? window.location.host : (app.activeRemote?.url ?? '')}
      </div>
    </div>
  </div>
{:else if app.phase === 'needs-remote'}
  <Onboarding />
{:else if app.phase === 'host-login'}
  <HostLogin />
{:else if app.phase === 'ready'}
  <Workspace />
{:else if app.phase === 'offline' || app.phase === 'unauthorized' || app.phase === 'error'}
  <ConnectionError />
{:else}
  <Onboarding />
{/if}
