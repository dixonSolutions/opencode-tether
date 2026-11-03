<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { settings } from '$lib/state/settings.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Root as Input } from '$lib/components/ui/input/index.js';
  import { Root as Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Root as Skeleton } from '$lib/components/ui/skeleton/index.js';
  import { cn } from '$lib/utils';
  import Search from '@lucide/svelte/icons/search';
  import Check from '@lucide/svelte/icons/check';
  import Star from '@lucide/svelte/icons/star';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Brain from '@lucide/svelte/icons/brain';
  import Paperclip from '@lucide/svelte/icons/paperclip';

  let { open = $bindable(false) }: { open?: boolean } = $props();
  let query = $state('');

  $effect(() => {
    if (open) void app.loadProviders();
  });

  const grouped = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const models = app.modelCatalog.filter((model) => {
      if (!q) return true;
      const provider = app.providers?.find((p) => p.id === model.providerID);
      return (
        model.name?.toLowerCase().includes(q) ||
        model.id.toLowerCase().includes(q) ||
        provider?.name.toLowerCase().includes(q) ||
        model.family?.toLowerCase().includes(q)
      );
    });
    const map = new Map<string, typeof models>();
    for (const model of models) {
      const key = model.providerID;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(model);
    }
    const favorite = (model: (typeof models)[number]) => settings.favorites.includes(`${model.providerID}/${model.id}`);
    for (const list of map.values()) list.sort((a, b) => Number(favorite(b)) - Number(favorite(a)) || (a.name ?? a.id).localeCompare(b.name ?? b.id));
    return [...map.entries()].sort((a, b) => {
      const an = app.providers?.find((p) => p.id === a[0])?.name ?? a[0];
      const bn = app.providers?.find((p) => p.id === b[0])?.name ?? b[0];
      return an.localeCompare(bn);
    });
  });

  function providerName(id: string): string {
    return app.providers?.find((provider) => provider.id === id)?.name ?? id;
  }

  function choose(providerID: string, modelID: string) {
    app.setModel({ providerID, modelID });
    open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showCloseButton={false} class="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
    <Dialog.Header class="border-b border-border/60 px-4 py-3.5 sm:px-5">
      <Dialog.Title class="text-base">Model</Dialog.Title>
      <Dialog.Description class="sr-only">Choose the model opencode should use for this session.</Dialog.Description>
      <div class="relative mt-2.5">
        <Search class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input bind:value={query} placeholder="Search models and providers" class="h-11 pl-9 text-sm" autofocus />
      </div>
    </Dialog.Header>
    <div class="tether-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-2.5 sm:p-3">
      {#if app.providersLoading && !app.providers}
        <div class="space-y-2 p-2">
          {#each Array(6) as _}<Skeleton class="h-14 w-full rounded-xl" />{/each}
        </div>
      {:else if grouped.length === 0}
        <div class="px-4 py-10 text-center text-sm text-muted-foreground">No models match “{query}”.</div>
      {:else}
        <button
          type="button"
          class="mb-1 flex min-h-12 w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted"
          onclick={() => {
            app.selectedModel = null;
            settings.lastModel = null;
            open = false;
          }}
        >
          <Sparkles class="size-4" /> Use server default
          {#if !app.selectedModel}<Check class="ml-auto size-4 text-tether" />{/if}
        </button>
        {#each grouped as [providerID, models]}
          <div class="mt-2">
            <div class="px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">{providerName(providerID)}</div>
            {#each models as model}
              {@const key = `${model.providerID}/${model.id}`}
              {@const selected = app.selectedModel?.providerID === model.providerID && app.selectedModel?.modelID === model.id}
              {@const favorite = settings.favorites.includes(key)}
              <div class={cn('group flex min-h-16 w-full items-center gap-1.5 rounded-xl px-1.5 py-1.5 transition-colors hover:bg-muted', selected && 'bg-muted/60')}>
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left"
                  onclick={() => choose(model.providerID, model.id)}
                >
                  <span class="min-w-0 flex-1">
                    <span class="flex items-center gap-1.5">
                      <span class="truncate text-[15px] font-medium">{model.name ?? model.id}</span>
                      {#if model.capabilities?.reasoning}<Brain class="size-4 shrink-0 text-violet-300/60" />{/if}
                      {#if model.capabilities?.attachment}<Paperclip class="size-4 shrink-0 text-muted-foreground/50" />{/if}
                    </span>
                    <span class="mt-1 flex items-center gap-2 text-xs text-muted-foreground/60">
                      <span class="truncate">{model.id}</span>
                      {#if model.limit?.context}<span>· {Math.round(model.limit.context / 1000)}k ctx</span>{/if}
                    </span>
                  </span>
                  {#if selected}<Check class="size-4 text-tether" />{/if}
                </button>
                <button
                  type="button"
                  class="touch-visible grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted-foreground/10 hover:text-tether"
                  aria-label={favorite ? `Remove ${model.name ?? model.id} from favorites` : `Favorite ${model.name ?? model.id}`}
                  aria-pressed={favorite}
                  onclick={(event) => {
                    event.stopPropagation();
                    settings.toggleFavoriteModel(key);
                  }}
                >
                  <Star class={cn('size-4', favorite && 'fill-current text-tether')} />
                </button>
              </div>
            {/each}
          </div>
        {/each}
      {/if}
    </div>
    <Dialog.Footer showCloseButton class="mx-0 mb-0 justify-between rounded-none border-t border-border/60 px-4 py-3 text-xs text-muted-foreground/60">
      <span>{app.modelCatalog.length} models</span>
      <span class="hidden sm:inline">Current: {app.selectedModel ? `${app.selectedModel.providerID}/${app.selectedModel.modelID}` : 'server default'}</span>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
