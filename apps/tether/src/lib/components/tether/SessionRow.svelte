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

  const ACTION_WIDTH = 168;

  let offset = $state(0);
  let dragging = $state(false);
  let startX = 0;
  let startOffset = 0;
  let moved = false;
  let lastSwipeAt = 0;

  const status = $derived(app.statuses[session.id]);
  const busy = $derived(status && status.type !== 'idle');
  const retry = $derived(status?.type === 'retry');
  const pending = $derived(
    app.permissions.some((item) => item.sessionID === session.id) || app.questions.some((item) => item.sessionID === session.id)
  );
  const title = $derived(session.title?.trim() || (session.slug ? session.slug.replace(/-/g, ' ') : 'Untitled session'));
  const directory = $derived(projectName(session.directory));

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    startX = event.clientX;
    startOffset = offset;
    moved = false;
    dragging = true;
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    const delta = event.clientX - startX;
    if (!moved && Math.abs(delta) < 6) return;
    moved = true;
    offset = Math.min(0, Math.max(-ACTION_WIDTH, startOffset + delta));
  }

  function settle(open: boolean) {
    if (open !== startOffset < 0) app.haptic(6);
    offset = open ? -ACTION_WIDTH : 0;
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    if (!moved) return;
    lastSwipeAt = Date.now();
    settle(offset < -ACTION_WIDTH / 2);
  }

  function onPointerCancel() {
    dragging = false;
    offset = startOffset;
  }

  function handleSelect() {
    if (Date.now() - lastSwipeAt < 350) return;
    if (offset !== 0) {
      offset = 0;
      return;
    }
    onselect();
  }

  function handleRename() {
    offset = 0;
    onrename();
  }

  function handleDelete() {
    offset = 0;
    ondelete();
  }
</script>

<div class="relative overflow-hidden rounded-xl" data-no-swipe>
  <div
    class={cn('absolute inset-y-0 right-0 flex transition-opacity lg:hidden', offset === 0 ? 'pointer-events-none opacity-0' : 'opacity-100')}
    style:width="{ACTION_WIDTH}px"
  >
    <button
      type="button"
      class="flex flex-1 flex-col items-center justify-center gap-1.5 bg-muted text-[13px] font-medium text-foreground"
      onclick={handleRename}
      aria-label="Rename session"
    >
      <Pencil class="size-4" /> Rename
    </button>
    <button
      type="button"
      class="flex flex-1 flex-col items-center justify-center gap-1.5 bg-red-500 text-[13px] font-medium text-white"
      onclick={handleDelete}
      aria-label="Delete session"
    >
      <Trash2 class="size-4" /> Delete
    </button>
  </div>

  <div
    class={cn(
      'group relative flex min-h-16 items-start gap-2.5 rounded-xl px-3 py-2.5 touch-pan-y',
      !dragging && 'transition-transform duration-150 ease-out',
      active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'bg-sidebar hover:bg-sidebar-accent/55'
    )}
    role="presentation"
    style:transform="translateX({offset}px)"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerCancel}
  >
    <button type="button" class="absolute inset-0 z-20 rounded-xl" onclick={handleSelect} aria-label={`Open ${title}`}></button>
    <span class="pointer-events-none relative z-10 mt-1.5 flex size-2.5 shrink-0 items-center justify-center">
      {#if busy}
        <span class={cn('size-2 rounded-full', retry ? 'bg-amber-400' : 'live-dot bg-tether')}></span>
      {:else if pending}
        <span class="size-2 rounded-full bg-amber-400"></span>
      {:else}
        <span class="size-2 rounded-full bg-muted-foreground/20"></span>
      {/if}
    </span>
    <span class="pointer-events-none relative z-10 min-w-0 flex-1">
      <span class="flex items-center gap-1.5">
        <span class={cn('truncate text-[15px] leading-6', active ? 'font-semibold' : 'font-normal text-foreground/90')}>{title}</span>
        {#if pending}
          <span class="flex shrink-0 items-center gap-1 text-amber-400" title="Needs your attention">
            {#if app.questions.some((item) => item.sessionID === session.id)}<MessageCircleQuestion class="size-3.5" />{:else}<ShieldAlert class="size-3.5" />{/if}
          </span>
        {/if}
      </span>
      <span class="mt-0.5 flex items-center gap-1.5 text-xs leading-5 text-muted-foreground/65">
        {#if directory}<span class="max-w-36 truncate">{directory}</span><span>·</span>{/if}
        <span>{relativeTime(session.time.updated)}</span>
        {#if session.cost}<span class="hidden sm:inline">· {formatCost(session.cost)}</span>{/if}
      </span>
    </span>
    <div class="touch-visible relative z-30 mt-0.5 hidden shrink-0 transition-opacity lg:block lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <button class="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" {...props} aria-label="Session actions">
              <MoreHorizontal class="size-4" />
            </button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-48">
          <DropdownMenu.Item onclick={onrename}><Pencil class="size-4" /> Rename</DropdownMenu.Item>
          <DropdownMenu.Item onclick={ondelete} class="text-red-400"><Trash2 class="size-4" /> Delete</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  </div>
</div>
