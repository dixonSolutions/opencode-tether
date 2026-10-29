<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import Brand from './Brand.svelte';
  import StatusDot from './StatusDot.svelte';
  import RemotesSheet from './RemotesSheet.svelte';
  import { Root as Button } from '$lib/components/ui/button/index.js';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Server from '@lucide/svelte/icons/server';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import WifiOff from '@lucide/svelte/icons/wifi-off';
  import ShieldX from '@lucide/svelte/icons/shield-x';

  let remotesOpen = $state(false);
  let retrying = $state(false);

  async function retry() {
    retrying = true;
    await app.retry();
    retrying = false;
  }

  function chooseAnother() {
    app.phase = 'needs-remote';
  }
</script>

<div class="relative flex min-h-dvh flex-col overflow-y-auto bg-background">
  <div class="pointer-events-none absolute inset-x-0 top-0 h-[380px] bg-[radial-gradient(ellipse_at_top,rgba(250,178,131,0.08),transparent_65%)]"></div>
  <header class="android-safe-top relative z-10 flex items-center justify-between px-4 pt-5 sm:px-8">
    <Brand size={30} wordmark tagline />
    <span class="text-[9px] text-muted-foreground/40">{app.hostMode ? 'host mode' : 'remote mode'}</span>
  </header>
  <main class="relative z-10 mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-8 text-center">
    <span class="mx-auto grid size-12 place-items-center rounded-2xl border border-red-500/20 bg-red-500/[0.06] text-red-300">
      {#if app.phase === 'unauthorized'}<ShieldX class="size-5" />{:else}<WifiOff class="size-5" />{/if}
    </span>
    <h1 class="mt-3 text-[20px] font-semibold tracking-tight">
      {#if app.phase === 'unauthorized'}
        Authentication failed
      {:else}
        Can't reach this host
      {/if}
    </h1>
    <p class="mx-auto mt-1 max-w-xs text-[11px] leading-relaxed text-muted-foreground">
      {#if app.phase === 'unauthorized'}
        The host rejected the saved credentials. Update the host or re-enter your password.
      {:else}
        The host may be offline, the address may be wrong, or a firewall may be blocking the connection.
      {/if}
    </p>

    <div class="mt-4 rounded-xl border border-border/60 bg-card/40 px-3 py-2.5 text-left">
      <div class="flex items-center gap-2">
        <StatusDot state="offline" size={7} />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[11.5px] font-medium">{app.hostMode ? 'this host' : (app.activeRemote?.name ?? 'unknown host')}</span>
          <span class="block truncate font-mono text-[9px] text-muted-foreground/60">{app.hostMode ? window.location.origin : (app.activeRemote?.url ?? '')}</span>
        </span>
      </div>
      {#if app.lastError || app.connection.error}
        <div class="mt-1.5 border-t border-border/40 pt-1.5 text-[9.5px] leading-relaxed text-red-300/70">{app.lastError ?? app.connection.error}</div>
      {/if}
    </div>

    <div class="mt-4 flex flex-col gap-1.5">
      <Button class="h-9 gap-1.5 text-[12px]" onclick={retry} disabled={retrying}>
        {#if retrying}<span class="size-3 animate-spin rounded-full border border-current border-t-transparent"></span>{:else}<RefreshCw class="size-3.5" />{/if}
        Try again
      </Button>
      {#if !app.hostMode}
        <Button variant="outline" class="h-9 gap-1.5 text-[12px]" onclick={() => (remotesOpen = true)}>
          <Server class="size-3.5" /> Edit host or credentials
        </Button>
        <Button variant="ghost" class="h-8 gap-1 text-[10.5px] text-muted-foreground" onclick={chooseAnother}>
          <ArrowLeft class="size-3" /> Choose another host
        </Button>
      {:else}
        <Button variant="ghost" class="h-8 gap-1 text-[10.5px] text-muted-foreground" onclick={() => location.reload()}>
          <RefreshCw class="size-3" /> Reload host
        </Button>
      {/if}
    </div>
  </main>
  <footer class="android-safe-bottom relative z-10 px-4 pb-4 text-center text-[8.5px] text-muted-foreground/30">
    opencode-tether · check the host service, port, and credentials
  </footer>
</div>

<RemotesSheet bind:open={remotesOpen} />
