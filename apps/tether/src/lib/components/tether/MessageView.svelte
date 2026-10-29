<script lang="ts">
  import type { FilePart, MessageWithParts, TextPart } from '$lib/api/types';
  import Brand from './Brand.svelte';
  import PartView from './PartView.svelte';
  import { app } from '$lib/state/app.svelte';
  import { settings } from '$lib/state/settings.svelte';
  import { copyText, formatCost, formatTokens } from '$lib/platform';
  import { toast } from 'svelte-sonner';
  import { cn } from '$lib/utils';
  import Copy from '@lucide/svelte/icons/copy';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';

  let { message, isLast = false }: { message: MessageWithParts; isLast?: boolean } = $props();

  const info = $derived(message.info);
  const isUser = $derived(info.role === 'user');
  const streaming = $derived(!isUser && !info.time.completed && app.isBusy && isLast);
  const text = $derived(
    message.parts
      .filter((part): part is TextPart => part.type === 'text')
      .map((part) => part.text)
      .join('\n\n')
  );
  const lastTextID = $derived(
    [...message.parts].reverse().find((part) => part.type === 'text' && !(part as TextPart).ignored)?.id ?? null
  );
  const files = $derived(message.parts.filter((part): part is FilePart => part.type === 'file'));
  const time = $derived(new Date(info.time.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  const modelName = $derived(info.modelID?.split('/').pop() ?? info.modelID ?? '');
  const errorText = $derived(info.error?.data?.message ?? info.error?.message ?? '');

  async function copyMessage() {
    if (!text) return;
    const ok = await copyText(text);
    toast[ok ? 'success' : 'error'](ok ? 'Copied message' : 'Could not copy');
  }

  async function removeMessage() {
    if (!confirm('Delete this message?')) return;
    await app.deleteMessage(info.sessionID, info.id);
  }
</script>

<article class={cn('group/message relative', isUser ? 'flex flex-col items-end' : 'flex flex-col items-start')} data-message-id={info.id}>
  {#if isUser}
    <div class="max-w-[88%] rounded-2xl rounded-br-md border border-border/60 bg-secondary/80 px-3.5 py-2.5 shadow-sm sm:max-w-[78%]">
      {#each message.parts as part (part.id)}
        {#if part.type !== 'text' && part.type !== 'file'}
          <PartView {part} />
        {/if}
      {/each}
      {#each message.parts as part (part.id)}
        {#if part.type === 'text' && part.text.trim()}
          <div class="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-secondary-foreground">{part.text}</div>
        {/if}
      {/each}
      {#if files.length}
        <div class="mt-2 flex flex-wrap gap-2">
          {#each files as part (part.id)}
            <PartView part={part} />
          {/each}
        </div>
      {/if}
    </div>
    <div class="mt-1 flex items-center gap-1.5 pr-0.5 text-[9.5px] text-muted-foreground/60">
      {#if settings.showTimestamps}<span>{time}</span>{/if}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <button class="rounded p-0.5 opacity-100 transition-opacity hover:text-foreground sm:opacity-0 sm:group-hover/message:opacity-100" aria-label="Message actions">
            <MoreHorizontal class="size-3.5" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-36">
          <DropdownMenu.Item onclick={copyMessage}><Copy class="size-3.5" /> Copy</DropdownMenu.Item>
          <DropdownMenu.Item onclick={removeMessage} class="text-red-400"><Trash2 class="size-3.5" /> Delete</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  {:else}
    <div class="mb-1.5 flex items-center gap-2 pl-0.5">
      <Brand size={18} />
      <span class="text-[11px] font-medium text-foreground/80">{info.agent ?? 'opencode'}</span>
      {#if modelName}<span class="text-[9.5px] text-muted-foreground/50">{modelName}</span>{/if}
      {#if settings.showTimestamps}<span class="text-[9.5px] text-muted-foreground/40">{time}</span>{/if}
      {#if streaming}
        <span class="live-dot size-1.5 rounded-full bg-tether"></span>
      {/if}
    </div>
    <div class="w-full min-w-0 space-y-2.5 pl-[30px]">
      {#each message.parts as part (part.id)}
        {#if !(part.type === 'text' && (part as TextPart).ignored)}
          <PartView {part} streaming={streaming && part.id === lastTextID} />
        {/if}
      {/each}
      {#if message.parts.length === 0 && streaming}
        <div class="flex items-center gap-1 py-1">
          <span class="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]"></span>
          <span class="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]"></span>
          <span class="size-1.5 animate-bounce rounded-full bg-muted-foreground/60"></span>
        </div>
      {/if}
      {#if errorText}
        <div class="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-[12px] text-red-300/90">
          <CircleAlert class="mt-0.5 size-3.5 shrink-0" />
          <span class="min-w-0 break-words">{errorText}</span>
        </div>
      {/if}
    </div>
    <div class="mt-1.5 flex min-h-5 items-center gap-2 pl-[30px] text-[9.5px] text-muted-foreground/50">
      {#if info.tokens}
        <span>{formatTokens(info.tokens.input + info.tokens.output)} tokens</span>
        {#if info.cost}<span>· {formatCost(info.cost)}</span>{/if}
      {/if}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <button class="rounded p-0.5 opacity-100 transition-opacity hover:text-foreground sm:opacity-0 sm:group-hover/message:opacity-100" aria-label="Message actions">
            <MoreHorizontal class="size-3.5" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" class="w-36">
          <DropdownMenu.Item onclick={copyMessage}><Copy class="size-3.5" /> Copy</DropdownMenu.Item>
          <DropdownMenu.Item onclick={removeMessage} class="text-red-400"><Trash2 class="size-3.5" /> Delete</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  {/if}
</article>
