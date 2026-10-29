<script lang="ts">
  import type { Session } from '$lib/api/types';
  import { app } from '$lib/state/app.svelte';
  import SessionRow from './SessionRow.svelte';
  import { Root as Input } from '$lib/components/ui/input/index.js';
  import { Root as Button } from '$lib/components/ui/button/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { cn } from '$lib/utils';
  import Search from '@lucide/svelte/icons/search';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import MessageSquarePlus from '@lucide/svelte/icons/message-square-plus';

  let { onNavigate, onnew }: { onNavigate?: () => void; onnew?: () => void } = $props();

  let searchInput = $state<HTMLInputElement | null>(null);
  let renameOpen = $state(false);
  let renameValue = $state('');
  let renameTarget = $state<Session | null>(null);

  const groups = $derived.by(() => {
    const day = 86_400_000;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const buckets: Array<{ label: string; sessions: Session[] }> = [
      { label: 'Today', sessions: [] },
      { label: 'Yesterday', sessions: [] },
      { label: 'Previous 7 days', sessions: [] },
      { label: 'Older', sessions: [] }
    ];
    for (const session of app.filteredSessions) {
      const updated = session.time.updated ?? session.time.created;
      if (updated >= startOfToday) buckets[0].sessions.push(session);
      else if (updated >= startOfToday - day) buckets[1].sessions.push(session);
      else if (updated >= startOfToday - day * 7) buckets[2].sessions.push(session);
      else buckets[3].sessions.push(session);
    }
    return buckets.filter((bucket) => bucket.sessions.length > 0);
  });

  function select(session: Session) {
    app.selectSession(session.id);
    onNavigate?.();
  }

  function openRename(session: Session) {
    renameTarget = session;
    renameValue = session.title ?? '';
    renameOpen = true;
  }

  async function submitRename() {
    if (!renameTarget || !renameValue.trim()) return;
    await app.renameSession(renameTarget.id, renameValue.trim());
    renameOpen = false;
    renameTarget = null;
  }

  async function remove(session: Session) {
    if (!confirm(`Delete “${session.title ?? 'Untitled session'}”?`)) return;
    await app.deleteSession(session.id);
  }

  async function create() {
    await app.newSession();
    onNavigate?.();
    onnew?.();
  }

  function onKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (event.key === '/' && !target.closest('input, textarea, [contenteditable="true"]')) {
      event.preventDefault();
      searchInput?.focus();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="flex min-h-0 flex-1 flex-col">
  <div class="flex items-center gap-1.5 px-3 pb-1.5 pt-2">
    <div class="relative flex-1">
      <Search class="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/70" />
      <Input
        bind:ref={searchInput}
        bind:value={app.search}
        placeholder="Search sessions"
        class="h-7 rounded-lg border-transparent bg-muted/45 pl-7 pr-7 text-[11px] placeholder:text-muted-foreground/50 focus-visible:bg-muted/70"
      />
      {#if app.search}
        <button class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground" onclick={() => (app.search = '')} aria-label="Clear search">
          <X class="size-3" />
        </button>
      {/if}
    </div>
    <Button variant="ghost" size="icon-sm" class="size-7" onclick={create} title="New session" aria-label="New session">
      <Plus class="size-3.5" />
    </Button>
  </div>

  <div class="tether-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2">
    {#if app.sessionsLoading && app.sessions.length === 0}
      <div class="space-y-1 px-1.5 pt-2">
        {#each Array(6) as _}
          <div class="shimmer h-9 rounded-lg bg-muted/40"></div>
        {/each}
      </div>
    {:else if groups.length === 0}
      <div class="flex flex-col items-center px-4 py-12 text-center">
        <MessageSquarePlus class="size-5 text-muted-foreground/40" />
        <div class="mt-2 text-[11px] font-medium text-muted-foreground/70">
          {app.search ? 'No matching sessions' : 'No sessions yet'}
        </div>
        <div class="mt-0.5 text-[10px] text-muted-foreground/45">
          {app.search ? 'Try another search term.' : 'Start one from the composer.'}
        </div>
      </div>
    {:else}
      {#each groups as group}
        <div class="mt-3 first:mt-1">
          <div class="sticky top-0 z-10 flex items-center gap-2 bg-sidebar/95 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/45 backdrop-blur">
            {group.label}
            <span class="font-normal tracking-normal text-muted-foreground/30">{group.sessions.length}</span>
          </div>
          <div class="space-y-0.5">
            {#each group.sessions as session (session.id)}
              <SessionRow
                {session}
                active={app.selectedSessionId === session.id}
                onselect={() => select(session)}
                onrename={() => openRename(session)}
                ondelete={() => remove(session)}
              />
            {/each}
          </div>
        </div>
      {/each}
      <div class="h-2"></div>
    {/if}
  </div>
</div>

<Dialog.Root bind:open={renameOpen}>
  <Dialog.Content class="sm:max-w-sm">
    <Dialog.Header>
      <Dialog.Title class="text-sm">Rename session</Dialog.Title>
      <Dialog.Description class="text-xs text-muted-foreground">Choose a short, descriptive title.</Dialog.Description>
    </Dialog.Header>
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void submitRename();
      }}
    >
      <Input bind:value={renameValue} placeholder="Session title" autofocus />
      <Dialog.Footer class="mt-4">
        <Button type="button" variant="ghost" size="sm" onclick={() => (renameOpen = false)}>Cancel</Button>
        <Button type="submit" size="sm" disabled={!renameValue.trim()}>Save</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
