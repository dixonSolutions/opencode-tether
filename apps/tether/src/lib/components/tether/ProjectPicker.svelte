<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Root as Input } from '$lib/components/ui/input/index.js';
  import { Root as Button } from '$lib/components/ui/button/index.js';
  import { cn } from '$lib/utils';
  import { projectName } from '$lib/platform';
  import Check from '@lucide/svelte/icons/check';
  import Folder from '@lucide/svelte/icons/folder';
  import Layers from '@lucide/svelte/icons/layers';
  import CornerDownLeft from '@lucide/svelte/icons/corner-down-left';

  let { open = $bindable(false) }: { open?: boolean } = $props();
  let custom = $state('');

  $effect(() => {
    if (open) custom = app.selectedDirectory ?? '';
  });

  function choose(directory: string | null) {
    app.setDirectory(directory);
    open = false;
  }

  function submitCustom(event: SubmitEvent) {
    event.preventDefault();
    if (!custom.trim()) return;
    choose(custom);
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[78dvh] gap-0 overflow-hidden p-0 sm:max-w-lg">
    <Dialog.Header class="border-b border-border/60 px-4 py-3">
      <Dialog.Title class="text-sm">Project &amp; directory</Dialog.Title>
      <Dialog.Description class="text-xs text-muted-foreground">
        New sessions start in the selected directory. The choice is remembered for this host.
      </Dialog.Description>
    </Dialog.Header>

    <div class="tether-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
      <button
        type="button"
        class={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-muted', !app.selectedDirectory && 'bg-muted/60')}
        onclick={() => choose(null)}
      >
        <Layers class="size-3.5 text-muted-foreground" />
        <span class="min-w-0 flex-1">
          <span class="block text-[12.5px] font-medium">All projects</span>
          <span class="block text-[10px] text-muted-foreground/60">Server default directory for new sessions</span>
        </span>
        {#if !app.selectedDirectory}<Check class="size-3.5 text-tether" />{/if}
      </button>

      {#if app.directoryOptions.length}
        <div class="mt-2 px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">Directories</div>
        {#each app.directoryOptions as directory}
          {@const selected = app.selectedDirectory === directory}
          <button
            type="button"
            class={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-muted', selected && 'bg-muted/60')}
            onclick={() => choose(directory)}
          >
            <Folder class="size-3.5 shrink-0 text-tether/80" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[12.5px] font-medium">{projectName(directory)}</span>
              <span class="block truncate text-[10px] text-muted-foreground/60">{directory}</span>
            </span>
            {#if selected}<Check class="size-3.5 text-tether" />{/if}
          </button>
        {/each}
      {:else}
        <div class="px-4 py-6 text-center text-xs text-muted-foreground">No projects reported by this host yet. Enter a directory below.</div>
      {/if}
    </div>

    <form class="flex items-center gap-2 border-t border-border/60 p-3" onsubmit={submitCustom}>
      <Input bind:value={custom} placeholder="/path/to/project" class="h-8 font-mono text-xs" aria-label="Directory path" />
      <Button type="submit" size="sm" class="h-8 gap-1.5" disabled={!custom.trim()}>
        <CornerDownLeft class="size-3.5" /> Use
      </Button>
    </form>
  </Dialog.Content>
</Dialog.Root>
