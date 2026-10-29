<script lang="ts">
  import type { Session } from '$lib/api/types';
  import { app } from '$lib/state/app.svelte';
  import { formatCost, projectName, relativeTime } from '$lib/platform';
  import { cn } from '$lib/utils';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import ShieldAlert from '@lucide/svelte/icons/shield-alert';
  import MessageCircleQuestion from '@lucide/svelte/icons/message-circle-question';

  let {
    session,
    active = false,
    onselect,
    onrename,
    ondelete
  }: {
    session: Session;
    active?: boolean;
    onselect: () => void;
    onrename: () => void;
    ondelete: () => void;
  } = $props();

  const status = $derived(app.statuses[session.id]);
  const busy = $derived(status && status.type !== 'idle');
  const retry = $derived(status?.type === 'retry');
  const pending = $derived(
    app.permissions.some((item) => item.sessionID === session.id) || app.questions.some((item) => item.sessionID === session.id)
  );
  const title = $derived(session.title?.trim() || (session.slug ? session.slug.replace(/-/g, ' ') : 'Untitled session'));
  const directory = $derived(projectName(session.directory));
</script>

<div
  class={cn(
    'group relative flex items-start gap-2 rounded-lg px-2 py-2 transition-colors',
    active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent/55'
  )}
>
  <button type="button" class="absolute inset-0 z-20 rounded-lg" onclick={onselect} aria-label={`Open ${title}`}></button>
  <span class="pointer-events-none relative z-10 mt-1.5 flex size-2 shrink-0 items-center justify-center">
    {#if busy}
      <span class={cn('size-1.5 rounded-full', retry ? 'bg-amber-400' : 'live-dot bg-tether')}></span>
    {:else if pending}
      <span class="size-1.5 rounded-full bg-amber-400"></span>
    {:else}
      <span class="size-1.5 rounded-full bg-muted-foreground/20"></span>
    {/if}
  </span>
  <span class="pointer-events-none relative z-10 min-w-0 flex-1">
    <span class="flex items-center gap-1">
      <span class={cn('truncate text-[12px] leading-5', active ? 'font-medium' : 'font-normal text-foreground/85')}>{title}</span>
      {#if pending}
        <span class="flex shrink-0 items-center gap-0.5 text-amber-400" title="Needs your attention">
          {#if app.questions.some((item) => item.sessionID === session.id)}<MessageCircleQuestion class="size-2.5" />{:else}<ShieldAlert class="size-2.5" />{/if}
        </span>
      {/if}
    </span>
    <span class="mt-0.5 flex items-center gap-1 text-[9.5px] leading-4 text-muted-foreground/60">
      {#if directory}<span class="max-w-28 truncate">{directory}</span><span>·</span>{/if}
      <span>{relativeTime(session.time.updated)}</span>
      {#if session.cost}<span class="hidden sm:inline">· {formatCost(session.cost)}</span>{/if}
    </span>
  </span>
  <div class="relative z-30 mt-0.5 shrink-0 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <button class="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" {...props} aria-label="Session actions">
            <MoreHorizontal class="size-3.5" />
          </button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-40">
        <DropdownMenu.Item onclick={onrename}><Pencil class="size-3.5" /> Rename</DropdownMenu.Item>
        <DropdownMenu.Item onclick={ondelete} class="text-red-400"><Trash2 class="size-3.5" /> Delete</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
</div>
