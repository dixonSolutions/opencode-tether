<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '$lib/state/app.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Root as Input } from '$lib/components/ui/input/index.js';
  import { Root as Button } from '$lib/components/ui/button/index.js';
  import Check from '@lucide/svelte/icons/check';
  import Folder from '@lucide/svelte/icons/folder';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import Home from '@lucide/svelte/icons/house';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Search from '@lucide/svelte/icons/search';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import X from '@lucide/svelte/icons/x';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import CornerDownLeft from '@lucide/svelte/icons/corner-down-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';

  let { open = $bindable(false) }: { open?: boolean } = $props();
  let query = $state('');
  let manual = $state(false);
  let manualPath = $state('');
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let pathbar: HTMLDivElement;

  const browse = $derived(app.directoryBrowser);
  const currentPath = $derived(browse.path ?? '');
  const home = $derived(browse.home ?? '');
  const selected = $derived(app.selectedDirectory);

  $effect(() => {
    if (!open) return;
    untrack(() => {
      query = '';
      manual = false;
      manualPath = app.selectedDirectory ?? '';
      void app.openDirectoryBrowser(app.selectedDirectory);
    });
  });

  $effect(() => {
    if (!open) return;
    const value = query;
    if (searchTimer) clearTimeout(searchTimer);
    if (!value.trim() || value.trim().startsWith('/') || value.trim().startsWith('~')) {
      untrack(() => void app.searchDirectories(''));
      return;
    }
    searchTimer = setTimeout(() => untrack(() => void app.searchDirectories(value)), 220);
    return () => {
      if (searchTimer) clearTimeout(searchTimer);
    };
  });

  const absoluteQuery = $derived(query.trim().startsWith('/') || query.trim().startsWith('~'));
  const filtered = $derived.by(() => {
    if (absoluteQuery) return [];
    const q = query.trim().toLowerCase();
    if (!q) return browse.entries;
    return browse.entries.filter((entry) => entry.name.toLowerCase().includes(q));
  });
  const searchOnly = $derived(browse.searchResults.filter((result) => !filtered.some((entry) => result === entry.name)));
  const canChoose = $derived(!!currentPath && !browse.loading && !browse.error);

  $effect(() => {
    currentPath;
    requestAnimationFrame(() => {
      if (pathbar) pathbar.scrollLeft = pathbar.scrollWidth;
    });
  });

  const crumbs = $derived.by(() => {
    if (!currentPath) return [];
    const parts = currentPath.split('/').filter(Boolean);
    const list: Array<{ label: string; path: string }> = [{ label: '/', path: '/' }];
    let path = '';
    for (const part of parts) {
      path += `/${part}`;
      list.push({ label: part, path });
    }
    return list;
  });

  function join(base: string, name: string): string {
    if (name.startsWith('/')) return name.replace(/\/+$/, '') || '/';
    return `${base.replace(/\/+$/, '')}/${name.replace(/^\/+/, '').replace(/\/+$/, '')}`;
  }

  function choose(directory: string | null) {
    app.setDirectory(directory);
    open = false;
  }

  function go(path: string) {
    if (!path.trim()) return;
    query = '';
    void app.browseDirectory(path.trim());
  }

  function submitManual(event: SubmitEvent) {
    event.preventDefault();
    if (!manualPath.trim()) return;
    manual = false;
    go(manualPath);
  }

  async function retry() {
    await app.browseDirectory(currentPath || home || '/');
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showCloseButton={false} class="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
    <Dialog.Header class="flex flex-row items-center gap-3 border-b border-border/60 px-4 py-3.5 sm:px-5">
      <div class="min-w-0 flex-1">
        <Dialog.Title class="flex items-center gap-2 text-base"><FolderOpen class="size-5 text-tether" /> Choose a folder</Dialog.Title>
        <Dialog.Description class="mt-0.5 text-sm text-muted-foreground">
          New sessions start in the selected folder on the connected host.
        </Dialog.Description>
      </div>
      <Dialog.Close>
        {#snippet child({ props })}
          <Button variant="ghost" size="sm" class="shrink-0 gap-1.5 px-3" {...props}>
            <X class="size-4" /> Close
          </Button>
        {/snippet}
      </Dialog.Close>
    </Dialog.Header>

    <div class="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2.5 sm:px-4">
      <Button variant="outline" size="sm" class="gap-1.5" onclick={() => go(home)} disabled={!home} title="Home folder">
        <Home class="size-4" /> Home
      </Button>
      <Button variant="outline" size="sm" class="gap-1.5" onclick={() => browse.parent && go(browse.parent)} disabled={!browse.parent} title="Parent folder">
        <ArrowUp class="size-4" /> Up
      </Button>
      <div bind:this={pathbar} class="tether-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-lg border border-border/60 bg-muted/25 px-2 py-1.5 text-sm">
        {#each crumbs as crumb, index}
          <button type="button" class="shrink-0 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground" onclick={() => go(crumb.path)}>
            {crumb.label}
          </button>
          {#if index < crumbs.length - 1}<ChevronRight class="size-3.5 shrink-0 text-muted-foreground/40" />{/if}
        {/each}
        {#if !crumbs.length}<span class="truncate text-muted-foreground">Loading…</span>{/if}
      </div>
      <Button variant="ghost" size="icon-sm" onclick={retry} title="Refresh folder" aria-label="Refresh folder">
        <RefreshCw class="size-4" />
      </Button>
    </div>

    <div class="space-y-2.5 px-3 pt-3 sm:px-4">
      <div class="relative">
        <Search class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
        <Input bind:value={query} placeholder="Search folders here and below…" class="h-11 pl-9 pr-12 text-sm" aria-label="Search folders" />
        {#if query}
          <button type="button" class="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:text-foreground" onclick={() => (query = '')} aria-label="Clear search">
            <X class="size-4" />
          </button>
        {/if}
      </div>
      {#if browse.searching}
        <div class="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Loader2 class="size-3.5 animate-spin" /> Searching subfolders…
        </div>
      {/if}
      {#if absoluteQuery}
        <button
          type="button"
          class="flex min-h-12 w-full items-center gap-2.5 rounded-xl border border-border/60 bg-card/40 px-3 text-left text-sm hover:bg-muted"
          onclick={() => go(query)}
        >
          <CornerDownLeft class="size-4 text-tether" />
          <span class="min-w-0 flex-1 truncate">Open <span class="font-mono">{query}</span></span>
        </button>
      {/if}

    </div>

    <div class="tether-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 sm:px-3">
      {#if browse.error}
        <div class="m-2 rounded-xl border border-red-500/25 bg-red-500/[0.06] p-4">
          <div class="flex items-start gap-2.5 text-sm text-red-200/90">
            <CircleAlert class="mt-0.5 size-4 shrink-0" />
            <div class="min-w-0 flex-1">
              <div class="font-medium">Could not open this folder</div>
              <div class="mt-1 text-red-200/70">{browse.error}</div>
              <div class="mt-2 text-xs leading-relaxed text-muted-foreground/70">
                The app reads folders through the host's opencode server. Make sure the host can read this path and that opencode allows directory access.
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onclick={retry}><RefreshCw class="size-4" /> Try again</Button>
                {#if home}<Button size="sm" variant="ghost" onclick={() => go(home)}><Home class="size-4" /> Go home</Button>{/if}
              </div>
            </div>
          </div>
        </div>
      {:else if browse.loading && !browse.entries.length}
        <div class="space-y-1.5 p-1">
          {#each Array(8) as _}<div class="shimmer h-14 rounded-xl bg-muted/35"></div>{/each}
        </div>
      {:else}
        {#if selected && currentPath && selected.replace(/\/+$/, '') === currentPath.replace(/\/+$/, '')}
          <div class="mb-1 flex items-center gap-2 rounded-xl border border-tether/25 bg-tether/[0.06] px-3 py-2.5 text-sm text-tether">
            <Check class="size-4" /> Current selection
          </div>
        {/if}

        {#if filtered.length === 0 && !searchOnly.length && !absoluteQuery && !browse.searching}
          <div class="px-4 py-10 text-center text-sm text-muted-foreground">
            {#if query}
              No folders match “{query}”.
            {:else}
              This folder has no subfolders.
            {/if}
          </div>
        {/if}

        {#if filtered.length}
          <div class="px-2 pb-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/50">
            {query ? 'Folders here' : 'Folders'}
          </div>
          {#each filtered as entry (entry.absolute ?? entry.path)}
            <button
              type="button"
              class="group flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-muted/70"
              onclick={() => go(join(currentPath, entry.name))}
            >
              <span class="grid size-9 shrink-0 place-items-center rounded-lg border border-border/60 bg-muted/40 text-tether/80">
                <Folder class="size-4" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[15px] font-medium">{entry.name}</span>
                <span class="block truncate text-xs text-muted-foreground/60">{entry.absolute ?? join(currentPath, entry.name)}</span>
              </span>
              <ChevronRight class="size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
            </button>
          {/each}
        {/if}

        {#if searchOnly.length}
          <div class="mt-2 px-2 pb-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/50">
            Matching subfolders
          </div>
          {#each searchOnly as result}
            {@const target = join(currentPath, result)}
            <button
              type="button"
              class="group flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-muted/70"
              onclick={() => go(target)}
            >
              <span class="grid size-9 shrink-0 place-items-center rounded-lg border border-border/60 bg-muted/40 text-muted-foreground">
                <Search class="size-4" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[15px] font-medium">{result.replace(/\/$/, '')}</span>
                <span class="block truncate text-xs text-muted-foreground/60">{target}</span>
              </span>
              <ChevronRight class="size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
            </button>
          {/each}
        {/if}
      {/if}
    </div>

    <div class="android-safe-bottom space-y-2 border-t border-border/60 bg-popover/95 px-3 py-3 sm:px-4">
      {#if manual}
        <form class="flex items-center gap-2" onsubmit={submitManual}>
          <Input bind:value={manualPath} placeholder="/absolute/path/to/folder" class="h-11 flex-1 font-mono text-sm" aria-label="Folder path" />
          <Button type="submit" class="h-11 gap-1.5" disabled={!manualPath.trim()}><CornerDownLeft class="size-4" /> Open</Button>
          <Button type="button" variant="ghost" class="h-11" onclick={() => (manual = false)}>Cancel</Button>
        </form>
      {:else}
        <div class="min-w-0 text-xs text-muted-foreground/70">
          <span class="block truncate">Selected: <span class="font-mono text-foreground/80">{currentPath || '—'}</span>{#if browse.loading} <span class="text-muted-foreground/50">· loading…</span>{/if}{#if browse.error} <span class="text-red-300/80">· unavailable</span>{/if}</span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" class="gap-1.5" onclick={() => { manualPath = currentPath || home; manual = true; }}><CornerDownLeft class="size-4" /> Type a path</Button>
          <div class="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onclick={() => choose(null)} disabled={!selected}>Host default</Button>
            <Button size="sm" class="gap-1.5" onclick={() => choose(currentPath || null)} disabled={!canChoose}>
              <Check class="size-4" /> Use this folder
            </Button>
          </div>
        </div>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
