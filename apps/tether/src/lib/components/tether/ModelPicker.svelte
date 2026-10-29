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

  function toggleFavorite(event: MouseEvent, key: string) {
    event.stopPropagation();
    settings.toggleFavoriteModel(key);
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[78dvh] gap-0 overflow-hidden p-0 sm:max-w-lg">
    <Dialog.Header class="border-b border-border/60 px-4 py-3">
      <Dialog.Title class="text-sm">Model</Dialog.Title>
      <Dialog.Description class="sr-only">Choose the model opencode should use for this session.</Dialog.Description>
      <div class="relative mt-2">
        <Search class="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input bind:value={query} placeholder="Search models and providers" class="h-8 pl-8 text-xs" autofocus />
      </div>
    </Dialog.Header>
    <div class="tether-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
      {#if app.providersLoading && !app.providers}
        <div class="space-y-2 p-2">
          {#each Array(6) as _}<Skeleton class="h-11 w-full rounded-lg" />{/each}
        </div>
      {:else if grouped.length === 0}
        <div class="px-4 py-10 text-center text-xs text-muted-foreground">No models match “{query}”.</div>
      {:else}
        <button
          type="button"
          class="mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-muted-foreground hover:bg-muted"
          onclick={() => {
            app.selectedModel = null;
            settings.lastModel = null;
            open = false;
          }}
        >
          <Sparkles class="size-3.5" /> Use server default
          {#if !app.selectedModel}<Check class="ml-auto size-3.5 text-tether" />{/if}
        </button>
        {#each grouped as [providerID, models]}
          <div class="mt-2">
            <div class="px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">{providerName(providerID)}</div>
            {#each models as model}
              {@const key = `${model.providerID}/${model.id}`}
              {@const selected = app.selectedModel?.providerID === model.providerID && app.selectedModel?.modelID === model.id}
              <button
                type="button"
                class={cn(
                  'group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted',
                  selected && 'bg-muted/60'
                )}
                onclick={() => choose(model.providerID, model.id)}
              >
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-1.5">
                    <span class="truncate text-[12.5px] font-medium">{model.name ?? model.id}</span>
                    {#if model.capabilities?.reasoning}<Brain class="size-3 shrink-0 text-violet-300/60" />{/if}
                    {#if model.capabilities?.attachment}<Paperclip class="size-3 shrink-0 text-muted-foreground/50" />{/if}
                  </span>
                  <span class="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                    <span class="truncate">{model.id}</span>
                    {#if model.limit?.context}<span>· {Math.round(model.limit.context / 1000)}k ctx</span>{/if}
                  </span>
                </span>
                {#if settings.favorites.includes(key)}
                  <Star class="size-3.5 text-tether" />
                {:else}
                  <span class="opacity-0 group-hover:opacity-100" role="presentation" onclick={(event) => toggleFavorite(event, key)}>
                    <Star class="size-3.5 text-muted-foreground/60" />
                  </span>
                {/if}
                {#if selected}<Check class="size-3.5 text-tether" />{/if}
              </button>
            {/each}
          </div>
        {/each}
      {/if}
    </div>
    <div class="flex items-center justify-between border-t border-border/60 px-4 py-2 text-[10px] text-muted-foreground/60">
      <span>{app.modelCatalog.length} models</span>
      <span class="hidden sm:inline">Current: {app.selectedModel ? `${app.selectedModel.providerID}/${app.selectedModel.modelID}` : 'server default'}</span>
    </div>
  </Dialog.Content>
</Dialog.Root>
