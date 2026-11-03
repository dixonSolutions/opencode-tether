<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { cn } from '$lib/utils';
  import Check from '@lucide/svelte/icons/check';
  import Bot from '@lucide/svelte/icons/bot';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  function choose(name: string) {
    app.setAgent(name);
    open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showCloseButton={false} class="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
    <Dialog.Header class="border-b border-border/60 px-4 py-3.5 sm:px-5">
      <Dialog.Title class="text-base">Agent</Dialog.Title>
      <Dialog.Description class="sr-only">Choose the opencode agent for this session.</Dialog.Description>
    </Dialog.Header>
    <div class="tether-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-2.5 sm:p-3">
      {#each app.visibleAgents as agent}
        <button
          type="button"
          class={cn('flex min-h-16 w-full items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-muted', app.selectedAgent === agent.name && 'bg-muted/60')}
          onclick={() => choose(agent.name)}
        >
          <span class="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl border border-border/60 bg-muted/50">
            <Bot class="size-5 text-tether" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-2 text-[15px] font-medium">
              {agent.name}
              {#if agent.native}<Badge variant="secondary" class="px-1.5 py-0.5 text-[10px] uppercase tracking-wide">built-in</Badge>{/if}
            </span>
            <span class="mt-1 block text-sm leading-snug text-muted-foreground">{agent.description ?? agent.mode}</span>
          </span>
          {#if app.selectedAgent === agent.name}<Check class="mt-1 size-4 text-tether" />{/if}
        </button>
      {:else}
        <div class="px-4 py-8 text-center text-sm text-muted-foreground">No primary agents are available on this host.</div>
      {/each}
    </div>
    <Dialog.Footer showCloseButton class="mx-0 mb-0 rounded-none border-t border-border/60 px-4 py-3" />
  </Dialog.Content>
</Dialog.Root>
