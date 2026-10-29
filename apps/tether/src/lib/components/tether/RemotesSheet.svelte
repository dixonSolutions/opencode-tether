<script lang="ts">
  import type { Remote, RemoteHealth } from '$lib/api/types';
  import { app } from '$lib/state/app.svelte';
  import { settings } from '$lib/state/settings.svelte';
  import { checkRemote } from '$lib/api/health';
  import { openExternal, relativeTime } from '$lib/platform';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import { Root as Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import StatusDot from './StatusDot.svelte';
  import RemoteForm from './RemoteForm.svelte';
  import { cn } from '$lib/utils';
  import Server from '@lucide/svelte/icons/server';
  import Plus from '@lucide/svelte/icons/plus';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Star from '@lucide/svelte/icons/star';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Check from '@lucide/svelte/icons/check';
  import { DOCS_URL } from '$lib/constants';

  let { open = $bindable(false) }: { open?: boolean } = $props();
  let healths = $state<Record<string, RemoteHealth>>({});
  let checking = $state(false);
  let formOpen = $state(false);
  let editing = $state<Remote | null>(null);
  let connecting = $state<string | null>(null);

  $effect(() => {
    if (open) void refreshHealth();
  });

  async function refreshHealth() {
    checking = true;
    const results = await Promise.all(
      settings.remotes.map(async (remote) => {
        if (remote.id === app.activeRemote?.id && app.connection.checkedAt) {
          return [remote.id, app.connection] as const;
        }
        return [remote.id, await checkRemote(remote)] as const;
      })
    );
    healths = Object.fromEntries(results);
    checking = false;
  }

  function healthFor(remote: Remote): RemoteHealth {
    return healths[remote.id] ?? (remote.id === app.activeRemote?.id ? app.connection : { state: 'unknown' });
  }

  function healthLabel(health: RemoteHealth): string {
    if (health.state === 'online') return health.busySessions ? `busy · ${health.busySessions}` : 'online';
    if (health.state === 'idle') return 'idle';
    if (health.state === 'unauthorized') return 'auth failed';
    if (health.state === 'offline') return 'offline';
    if (health.state === 'checking') return 'checking';
    return 'unknown';
  }

  async function select(remote: Remote) {
    connecting = remote.id;
    await app.switchRemote(remote);
    connecting = null;
    if (app.phase === 'ready') open = false;
  }

  function add() {
    editing = null;
    formOpen = true;
  }

  function edit(remote: Remote) {
    editing = remote;
    formOpen = true;
  }

  async function remove(remote: Remote) {
    if (!confirm(`Remove “${remote.name}” from saved hosts?`)) return;
    settings.removeRemote(remote.id);
    if (app.activeRemote?.id === remote.id) {
      const next = settings.lastRemote;
      if (next) await app.switchRemote(next);
      else await app.disconnect();
    }
  }

  async function saved(remote: Remote) {
    if (app.activeRemote?.id !== remote.id || app.phase !== 'ready') {
      await app.switchRemote(remote);
    }
    setTimeout(() => void refreshHealth(), 300);
  }
</script>

<Sheet.Root bind:open>
  <Sheet.Content side="right" class="w-full max-w-full gap-0 p-0 sm:max-w-md">
    <Sheet.Header class="android-safe-top border-b border-border/60 px-4 pb-3 pt-4">
      <Sheet.Title class="flex items-center gap-2 text-sm">
        <Server class="size-4 text-tether" /> Remotes
        <Badge variant="secondary" class="ml-1 px-1.5 py-0 text-[9px]">{settings.remotes.length}</Badge>
      </Sheet.Title>
      <Sheet.Description class="text-[11px] leading-relaxed text-muted-foreground">
        Saved opencode hosts. The last used host is selected automatically at launch; the starred host is the default.
      </Sheet.Description>
      <div class="mt-2 flex items-center gap-1.5">
        <Button size="sm" class="h-8 gap-1 text-[11px]" onclick={add}><Plus class="size-3.5" /> Add host</Button>
        <Button variant="outline" size="sm" class="h-8 gap-1 text-[11px]" onclick={refreshHealth} disabled={checking}>
          {#if checking}<Loader2 class="size-3 animate-spin" />{:else}<RefreshCw class="size-3" />{/if}
          Check health
        </Button>
      </div>
    </Sheet.Header>

    <div class="tether-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-2.5">
      {#if settings.remotes.length === 0}
        <div class="mx-1 mt-4 rounded-xl border border-dashed border-border/70 px-4 py-8 text-center">
          <Server class="mx-auto size-6 text-muted-foreground/40" />
          <div class="mt-2 text-[12px] font-medium">No hosts saved</div>
          <div class="mt-1 text-[10.5px] leading-relaxed text-muted-foreground/60">Add an opencode server or a machine running the opencode-tether host.</div>
          <Button size="sm" class="mt-3 h-8 text-[11px]" onclick={add}><Plus class="size-3.5" /> Add your first host</Button>
        </div>
      {:else}
        <div class="space-y-2">
          {#each settings.remotes as remote (remote.id)}
            {@const health = healthFor(remote)}
            {@const active = app.activeRemote?.id === remote.id && app.phase === 'ready'}
            {@const isDefault = settings.defaultRemoteId === remote.id}
            <div class={cn('rounded-xl border bg-card/35 p-2.5 transition-colors', active ? 'border-tether/35 bg-tether/[0.035]' : 'border-border/60 hover:border-border')}>
              <div class="flex items-start gap-2">
                <StatusDot state={health.state} size={8} class="mt-1.5" />
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="truncate text-[12px] font-semibold">{remote.name}</span>
                    {#if isDefault}<Badge variant="outline" class="border-tether/25 px-1 py-0 text-[8px] uppercase tracking-wide text-tether">default</Badge>{/if}
                    {#if active}<Badge class="bg-emerald-400/15 px-1 py-0 text-[8px] uppercase tracking-wide text-emerald-300">connected</Badge>{/if}
                    <span class="text-[9px] text-muted-foreground/50">{healthLabel(health)}</span>
                  </div>
                  <div class="mt-0.5 truncate font-mono text-[9.5px] text-muted-foreground/60">{remote.url}</div>
                  <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-muted-foreground/50">
                    {#if health.latencyMs}<span>{health.latencyMs}ms</span>{/if}
                    {#if health.version}<span>v{health.version}</span>{/if}
                    {#if health.busySessions}<span class="text-amber-400/70">{health.busySessions} busy</span>{/if}
                    {#if remote.lastUsedAt}<span>used {relativeTime(remote.lastUsedAt)}</span>{/if}
                    {#if remote.token}<span>key</span>{/if}
                  </div>
                  {#if health.error}<div class="mt-0.5 truncate text-[9px] text-red-300/70">{health.error}</div>{/if}
                </div>
                <div class="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    class={cn('grid size-6 place-items-center rounded-md hover:bg-muted', isDefault ? 'text-tether' : 'text-muted-foreground/50 hover:text-tether')}
                    onclick={() => settings.setDefault(remote.id)}
                    title={isDefault ? 'Default host' : 'Make default'}
                    aria-label="Make default host"
                  >
                    <Star class={cn('size-3.5', isDefault && 'fill-current')} />
                  </button>
                  <button type="button" class="grid size-6 place-items-center rounded-md text-muted-foreground/50 hover:bg-muted hover:text-foreground" onclick={() => edit(remote)} title="Edit host" aria-label="Edit host">
                    <Pencil class="size-3" />
                  </button>
                  <button type="button" class="grid size-6 place-items-center rounded-md text-muted-foreground/50 hover:bg-muted hover:text-red-400" onclick={() => remove(remote)} title="Remove host" aria-label="Remove host">
                    <Trash2 class="size-3" />
                  </button>
                </div>
              </div>
              <div class="mt-2 flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant={active ? 'outline' : 'secondary'}
                  class="h-7 flex-1 gap-1 text-[10.5px]"
                  onclick={() => select(remote)}
                  disabled={connecting === remote.id}
                >
                  {#if connecting === remote.id}<Loader2 class="size-3 animate-spin" />{:else if active}<Check class="size-3" />{:else}<ArrowRight class="size-3" />{/if}
                  {active ? 'Reconnect' : 'Connect'}
                </Button>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <div class="mx-1 mt-4 rounded-xl border border-border/50 bg-muted/20 p-3">
        <div class="flex items-center gap-1.5 text-[10.5px] font-medium text-foreground/80">
          <ShieldCheck class="size-3.5 text-tether" /> Better remote access
        </div>
        <p class="mt-1 text-[10px] leading-relaxed text-muted-foreground/65">
          The recommended setup is the opencode-tether host on the machine that runs opencode. It serves this app on one port, wraps the opencode API, and adds a single sign-in — no direct opencode port exposed.
        </p>
        <Button variant="link" size="sm" class="mt-1 h-6 px-0 text-[10px] text-tether" onclick={() => void openExternal(DOCS_URL)}>
          Setup guide <ArrowRight class="size-3" />
        </Button>
      </div>
    </div>

    <Sheet.Footer class="android-safe-bottom border-t border-border/60 px-4 pt-2">
      <div class="flex w-full items-center justify-between text-[9.5px] text-muted-foreground/50">
        <span>{settings.remotes.length} host{settings.remotes.length === 1 ? '' : 's'} saved</span>
        <span>Last used is remembered per host</span>
      </div>
    </Sheet.Footer>
  </Sheet.Content>
</Sheet.Root>

<RemoteForm bind:open={formOpen} remote={editing} onSaved={saved} />

