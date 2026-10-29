<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import Brand from './Brand.svelte';
  import StatusDot from './StatusDot.svelte';
  import SessionList from './SessionList.svelte';
  import { Root as Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import Plus from '@lucide/svelte/icons/plus';
  import Settings from '@lucide/svelte/icons/settings';
  import Server from '@lucide/svelte/icons/server';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Zap from '@lucide/svelte/icons/zap';

  let {
    onOpenRemotes,
    onOpenSettings,
    onNavigate
  }: { onOpenRemotes: () => void; onOpenSettings: () => void; onNavigate?: () => void } = $props();

  async function newSession() {
    await app.newSession();
    onNavigate?.();
  }

  const remote = $derived(app.activeRemote);
  const busy = $derived(app.connection.busySessions ?? Object.values(app.statuses).filter((status) => status.type !== 'idle').length);
</script>

<aside class="flex h-full min-h-0 w-full flex-col bg-sidebar text-sidebar-foreground">
  <div class="android-safe-top flex items-center gap-2 px-3 pb-2 pr-9">
    <Brand size={30} wordmark tagline />
    <div class="ml-auto flex items-center gap-1">
      {#if app.hostMode}
        <Badge variant="outline" class="border-tether/25 bg-tether/[0.06] px-1.5 py-0 text-[8px] uppercase tracking-wide text-tether">host</Badge>
      {/if}
      <button
        type="button"
        class="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        onclick={() => app.refreshAll()}
        title="Refresh"
        aria-label="Refresh host data"
      >
        <RefreshCw class="size-3.5" />
      </button>
    </div>
  </div>

  <div class="space-y-1.5 px-2 pb-2">
    {#if !app.hostMode}
      <button
        type="button"
        class="group flex w-full items-center gap-2 rounded-xl border border-sidebar-border/70 bg-card/35 px-2.5 py-2 text-left transition-colors hover:bg-card/70"
        onclick={onOpenRemotes}
      >
        <StatusDot state={app.connection.state} size={7} />
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-1">
            <span class="truncate text-[11.5px] font-semibold">{remote?.name ?? 'No host selected'}</span>
            {#if remote?.favorite}<Zap class="size-2.5 text-tether" />{/if}
          </span>
          <span class="block truncate text-[9.5px] text-muted-foreground/60">{remote?.url ?? 'Add a remote'}</span>
        </span>
        <span class="flex shrink-0 items-center gap-1">
          {#if app.pendingCount > 0}
            <span class="grid size-4 place-items-center rounded-full bg-amber-400 text-[8px] font-bold text-amber-950">{app.pendingCount}</span>
          {/if}
          <ChevronRight class="size-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
        </span>
      </button>
    {:else}
      <div class="flex items-center gap-2 rounded-xl border border-sidebar-border/70 bg-card/35 px-2.5 py-2">
        <StatusDot state={app.connection.state} size={7} />
        <span class="min-w-0 flex-1">
          <span class="block text-[11.5px] font-semibold">This host</span>
          <span class="block truncate text-[9.5px] text-muted-foreground/60">{window.location.host} · tether {app.host?.version ?? ''}</span>
        </span>
        <Server class="size-3.5 text-muted-foreground/40" />
      </div>
    {/if}

    <Button class="h-8 w-full justify-start gap-1.5 rounded-lg border border-tether/20 bg-tether/10 text-[11.5px] font-medium text-tether hover:bg-tether/15" size="sm" onclick={newSession}>
      <Plus class="size-3.5" /> New session
    </Button>
  </div>

  <div class="mx-2 h-px bg-sidebar-border/60"></div>
  <SessionList {onNavigate} onnew={onNavigate} />

  <div class="android-safe-bottom border-t border-sidebar-border/60 px-2 py-2">
    <div class="mb-1.5 flex items-center gap-2 px-1 text-[9px] text-muted-foreground/55">
      <StatusDot state={app.connection.state} size={5} />
      <span>
        {#if app.connection.state === 'online' || app.connection.state === 'idle'}
          {app.connection.latencyMs ?? '—'}ms{app.connection.version ? ` · v${app.connection.version}` : ''}
          {#if busy}<span class="text-amber-400/80"> · {busy} busy</span>{/if}
        {:else if app.connection.state === 'unauthorized'}
          authentication required
        {:else if app.connection.state === 'offline'}
          offline
        {:else}
          connecting…
        {/if}
      </span>
      <span class="ml-auto flex items-center gap-1">
        {#if app.eventState === 'live'}<span class="live-dot size-1 rounded-full bg-emerald-400"></span>{/if}
        <span class="uppercase tracking-wide">{app.eventState === 'live' ? 'live' : app.eventState === 'reconnecting' ? 'retry' : ''}</span>
      </span>
    </div>
    <div class="flex items-center gap-1">
      <Button variant="ghost" size="sm" class="h-7 flex-1 justify-start gap-1.5 px-1.5 text-[10.5px] text-muted-foreground hover:text-foreground" onclick={onOpenSettings}>
        <Settings class="size-3.5" /> Settings
      </Button>
      {#if !app.hostMode}
        <Button variant="ghost" size="sm" class="h-7 justify-start gap-1.5 px-1.5 text-[10.5px] text-muted-foreground hover:text-foreground" onclick={onOpenRemotes}>
          <Server class="size-3.5" /> Remotes
        </Button>
      {/if}
    </div>
  </div>
</aside>
