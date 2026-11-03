<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import Brand from './Brand.svelte';
  import StatusDot from './StatusDot.svelte';
  import SessionList from './SessionList.svelte';
  import ProjectPicker from './ProjectPicker.svelte';
  import { Root as Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import Plus from '@lucide/svelte/icons/plus';
  import Settings from '@lucide/svelte/icons/settings';
  import Server from '@lucide/svelte/icons/server';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Zap from '@lucide/svelte/icons/zap';
  import Folder from '@lucide/svelte/icons/folder';
  import X from '@lucide/svelte/icons/x';
  import { projectName } from '$lib/platform';

  let projectOpen = $state(false);

  let {
    onOpenRemotes,
    onOpenSettings,
    onNavigate,
    onClose
  }: { onOpenRemotes: () => void; onOpenSettings: () => void; onNavigate?: () => void; onClose?: () => void } = $props();

  async function newSession() {
    await app.newSession();
    onNavigate?.();
  }

  function openProjects() {
    projectOpen = true;
  }

  const remote = $derived(app.activeRemote);
  const busy = $derived(app.connection.busySessions ?? Object.values(app.statuses).filter((status) => status.type !== 'idle').length);
</script>

<aside class="flex h-full min-h-0 w-full flex-col bg-sidebar text-sidebar-foreground">
  <div class="android-safe-top flex min-h-16 items-center gap-2 px-3 pb-2 pt-2 sm:px-4">
    <div class="min-w-0 flex-1">
      <Brand size={34} wordmark tagline />
    </div>
    <div class="flex shrink-0 items-center gap-1.5">
      {#if app.hostMode}
        <Badge variant="outline" class="hidden border-tether/25 bg-tether/[0.06] px-2 py-0.5 text-[11px] uppercase tracking-wide text-tether sm:inline-flex">host</Badge>
      {/if}
      <Button variant="ghost" size="icon-sm" class="hidden sm:inline-flex" onclick={() => app.refreshAll()} title="Refresh host data" aria-label="Refresh host data">
        <RefreshCw class="size-4" />
      </Button>
      {#if onClose}
        <Button variant="ghost" size="sm" class="gap-1.5 px-2.5" onclick={onClose} aria-label="Close" title="Close menu">
          <X class="size-4" /> Close
        </Button>
      {/if}
    </div>
  </div>

  <div class="space-y-2 px-2 pb-3 sm:px-3">
    {#if !app.hostMode}
      <button
        type="button"
        class="group flex min-h-14 w-full items-center gap-3 rounded-xl border border-sidebar-border/70 bg-card/35 px-3 py-2.5 text-left transition-colors hover:bg-card/70"
        onclick={onOpenRemotes}
      >
        <StatusDot state={app.connection.state} size={9} />
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-1.5">
            <span class="truncate text-sm font-semibold">{remote?.name ?? 'No host selected'}</span>
            {#if remote?.favorite}<Zap class="size-3.5 text-tether" />{/if}
          </span>
          <span class="block truncate text-xs text-muted-foreground/60">{remote?.url ?? 'Add a remote'}</span>
        </span>
        <span class="flex shrink-0 items-center gap-1.5">
          {#if app.pendingCount > 0}
            <span class="grid size-5 place-items-center rounded-full bg-amber-400 text-[10px] font-bold text-amber-950">{app.pendingCount}</span>
          {/if}
          <ChevronRight class="size-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
        </span>
      </button>
    {:else}
      <div class="flex min-h-14 items-center gap-3 rounded-xl border border-sidebar-border/70 bg-card/35 px-3 py-2.5">
        <StatusDot state={app.connection.state} size={9} />
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold">This host</span>
          <span class="block truncate text-xs text-muted-foreground/60">{window.location.host} · tether {app.host?.version ?? ''}</span>
        </span>
        <Server class="size-4 text-muted-foreground/40" />
      </div>
    {/if}

    <button
      type="button"
      class="flex min-h-12 w-full items-center gap-2.5 rounded-xl border border-sidebar-border/60 bg-card/20 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
      onclick={openProjects}
      aria-label="Choose folder"
    >
      <Folder class="size-4 shrink-0" />
      <span class="min-w-0 flex-1 truncate">{app.selectedDirectory ? projectName(app.selectedDirectory) : 'All folders'}</span>
      <span class="shrink-0 text-xs text-muted-foreground/60">Change</span>
    </button>

    <Button class="h-11 w-full justify-start gap-2 rounded-xl border border-tether/20 bg-tether/10 text-sm font-medium text-tether hover:bg-tether/15" size="lg" onclick={newSession}>
      <Plus class="size-4" /> New session
    </Button>
  </div>

  <div class="mx-3 h-px bg-sidebar-border/60"></div>
  <SessionList {onNavigate} onnew={onNavigate} />
  <ProjectPicker bind:open={projectOpen} />

  <div class="android-safe-bottom border-t border-sidebar-border/60 px-2 py-2.5 sm:px-3">
    <div class="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground/60">
      <StatusDot state={app.connection.state} size={6} />
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
        {#if app.eventState === 'live'}<span class="live-dot size-1.5 rounded-full bg-emerald-400"></span>{/if}
        <span class="uppercase tracking-wide">{app.eventState === 'live' ? 'live' : app.eventState === 'reconnecting' ? 'retry' : ''}</span>
      </span>
    </div>
    <div class="flex items-center gap-1.5">
      <Button variant="ghost" size="sm" class="h-10 flex-1 justify-start gap-2 px-2.5 text-sm text-muted-foreground hover:text-foreground" onclick={onOpenSettings}>
        <Settings class="size-4" /> Settings
      </Button>
      {#if !app.hostMode}
        <Button variant="ghost" size="sm" class="h-10 justify-start gap-2 px-2.5 text-sm text-muted-foreground hover:text-foreground" onclick={onOpenRemotes}>
          <Server class="size-4" /> Remotes
        </Button>
      {/if}
    </div>
  </div>
</aside>
