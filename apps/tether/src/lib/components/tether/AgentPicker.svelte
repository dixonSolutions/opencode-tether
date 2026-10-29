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
  <Dialog.Content class="gap-0 overflow-hidden p-0 sm:max-w-md">
    <Dialog.Header class="border-b border-border/60 px-4 py-3">
      <Dialog.Title class="text-sm">Agent</Dialog.Title>
      <Dialog.Description class="sr-only">Choose the opencode agent for this session.</Dialog.Description>
    </Dialog.Header>
    <div class="tether-scroll max-h-[60dvh] overflow-y-auto p-2">
      {#each app.visibleAgents as agent}
        <button
          type="button"
          class={cn('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted', app.selectedAgent === agent.name && 'bg-muted/60')}
          onclick={() => choose(agent.name)}
        >
          <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-border/60 bg-muted/50">
            <Bot class="size-3.5 text-tether" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1.5 text-[12.5px] font-medium">
              {agent.name}
              {#if agent.native}<Badge variant="secondary" class="px-1 py-0 text-[8px] uppercase tracking-wide">built-in</Badge>{/if}
            </span>
            <span class="mt-0.5 block text-[10.5px] leading-snug text-muted-foreground">{agent.description ?? agent.mode}</span>
          </span>
          {#if app.selectedAgent === agent.name}<Check class="mt-1 size-3.5 text-tether" />{/if}
        </button>
      {:else}
        <div class="px-4 py-8 text-center text-xs text-muted-foreground">No primary agents are available on this host.</div>
      {/each}
    </div>
  </Dialog.Content>
</Dialog.Root>
