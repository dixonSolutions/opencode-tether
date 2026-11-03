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
  import X from '@lucide/svelte/icons/x';

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
  <Sheet.Content side="left" showCloseButton={false} class="safe-x w-[92%] max-w-[440px] gap-0 border-r border-border/60 p-0 sm:max-w-[460px]">
    <Sheet.Header class="android-safe-top flex flex-row items-start gap-3 border-b border-border/60 px-4 py-3.5 sm:px-5">
      <div class="min-w-0 flex-1">
        <Sheet.Title class="flex items-center gap-2 text-base">
          <Server class="size-5 text-tether" /> Remotes
          <Badge variant="secondary" class="ml-1 px-2 py-0 text-sm">{settings.remotes.length}</Badge>
        </Sheet.Title>
        <Sheet.Description class="mt-1 text-sm leading-relaxed text-muted-foreground">
          Saved opencode hosts. The last used host opens at launch; the starred host is the default.
        </Sheet.Description>
      </div>
      <Sheet.Close>
        {#snippet child({ props })}
          <Button variant="ghost" size="sm" class="shrink-0 gap-1.5 px-3" {...props}>
            <X class="size-4" /> Close
          </Button>
        {/snippet}
      </Sheet.Close>
    </Sheet.Header>
    <div class="flex items-center gap-2 border-b border-border/60 px-4 py-2.5 sm:px-5">
      <Button size="sm" class="h-10 gap-1.5 text-sm" onclick={add}><Plus class="size-4" /> Add host</Button>
      <Button variant="outline" size="sm" class="h-10 gap-1.5 text-sm" onclick={refreshHealth} disabled={checking}>
        {#if checking}<Loader2 class="size-4 animate-spin" />{:else}<RefreshCw class="size-4" />{/if}
        Check health
      </Button>
    </div>

    <div class="tether-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
      {#if settings.remotes.length === 0}
        <div class="mx-1 mt-4 rounded-xl border border-dashed border-border/70 px-4 py-8 text-center">
          <Server class="mx-auto size-7 text-muted-foreground/40" />
          <div class="mt-2 text-sm font-medium">No hosts saved</div>
          <div class="mt-1 text-sm leading-relaxed text-muted-foreground/60">Add an opencode server or a machine running the opencode-tether host.</div>
          <Button size="sm" class="mt-3 h-10 text-sm" onclick={add}><Plus class="size-3.5" /> Add your first host</Button>
        </div>
      {:else}
        <div class="space-y-2">
          {#each settings.remotes as remote (remote.id)}
            {@const health = healthFor(remote)}
            {@const active = app.activeRemote?.id === remote.id && app.phase === 'ready'}
            {@const isDefault = settings.defaultRemoteId === remote.id}
            <div class={cn('rounded-xl border bg-card/35 p-3.5 transition-colors', active ? 'border-tether/35 bg-tether/[0.035]' : 'border-border/60 hover:border-border')}>
              <div class="flex items-start gap-2">
                <StatusDot state={health.state} size={9} class="mt-2" />
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="truncate text-sm font-semibold">{remote.name}</span>
                    {#if isDefault}<Badge variant="outline" class="border-tether/25 px-1.5 py-0.5 text-xs uppercase tracking-wide text-tether">default</Badge>{/if}
                    {#if active}<Badge class="bg-emerald-400/15 px-1.5 py-0.5 text-xs uppercase tracking-wide text-emerald-300">connected</Badge>{/if}
                    <span class="text-xs text-muted-foreground/50">{healthLabel(health)}</span>
                  </div>
                  <div class="mt-1 truncate font-mono text-xs text-muted-foreground/60">{remote.url}</div>
                  <div class="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground/50">
                    {#if health.latencyMs}<span>{health.latencyMs}ms</span>{/if}
                    {#if health.version}<span>v{health.version}</span>{/if}
                    {#if health.busySessions}<span class="text-amber-400/70">{health.busySessions} busy</span>{/if}
                    {#if remote.lastUsedAt}<span>used {relativeTime(remote.lastUsedAt)}</span>{/if}
                    {#if remote.token}<span>key</span>{/if}
                  </div>
                  {#if health.error}<div class="mt-1 truncate text-xs text-red-300/70">{health.error}</div>{/if}
                </div>
                <div class="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    class={cn('grid size-9 place-items-center rounded-lg hover:bg-muted', isDefault ? 'text-tether' : 'text-muted-foreground/50 hover:text-tether')}
                    aria-pressed={isDefault}
                    onclick={() => settings.setDefault(remote.id)}
                    title={isDefault ? 'Default host' : 'Make default'}
                    aria-label="Make default host"
                  >
                    <Star class={cn('size-4', isDefault && 'fill-current')} />
                  </button>
                  <button type="button" class="grid size-9 place-items-center rounded-lg text-muted-foreground/50 hover:bg-muted hover:text-foreground" onclick={() => edit(remote)} title="Edit host" aria-label="Edit host">
                    <Pencil class="size-4" />
                  </button>
                  <button type="button" class="grid size-9 place-items-center rounded-lg text-muted-foreground/50 hover:bg-muted hover:text-red-400" onclick={() => remove(remote)} title="Remove host" aria-label="Remove host">
                    <Trash2 class="size-4" />
                  </button>
                </div>
              </div>
              <div class="mt-2 flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant={active ? 'outline' : 'secondary'}
                  class="h-10 flex-1 gap-1.5 text-sm"
                  onclick={() => select(remote)}
                  disabled={connecting === remote.id}
                >
                  {#if connecting === remote.id}<Loader2 class="size-4 animate-spin" />{:else if active}<Check class="size-4" />{:else}<ArrowRight class="size-4" />{/if}
                  {active ? 'Reconnect' : 'Connect'}
                </Button>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <div class="mx-1 mt-4 rounded-xl border border-border/50 bg-muted/20 p-3.5">
        <div class="flex items-center gap-2 text-sm font-medium text-foreground/80">
          <ShieldCheck class="size-4 text-tether" /> Better remote access
        </div>
        <p class="mt-1.5 text-sm leading-relaxed text-muted-foreground/65">
          The recommended setup is the opencode-tether host on the machine that runs opencode. It serves this app on one port, wraps the opencode API, and adds a single sign-in — no direct opencode port exposed.
        </p>
        <Button variant="link" size="sm" class="mt-2 h-10 px-0 text-sm text-tether" onclick={() => void openExternal(DOCS_URL)}>
          Setup guide <ArrowRight class="size-4" />
        </Button>
      </div>
    </div>

    <Sheet.Footer class="android-safe-bottom border-t border-border/60 px-4 pt-2">
      <div class="flex w-full items-center justify-between text-xs text-muted-foreground/50">
        <span>{settings.remotes.length} host{settings.remotes.length === 1 ? '' : 's'} saved</span>
        <span>Last used is remembered per host</span>
      </div>
    </Sheet.Footer>
  </Sheet.Content>
</Sheet.Root>

<RemoteForm bind:open={formOpen} remote={editing} onSaved={saved} />

