<script lang="ts">
  import type { Part, ReasoningPart, TextPart, FilePart } from '$lib/api/types';
  import Markdown from './Markdown.svelte';
  import ToolCall from './ToolCall.svelte';
  import { app } from '$lib/state/app.svelte';
  import { settings } from '$lib/state/settings.svelte';
  import { formatDuration } from '$lib/platform';
  import Brain from '@lucide/svelte/icons/brain';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import FileIcon from '@lucide/svelte/icons/file';
  import Download from '@lucide/svelte/icons/download';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Layers from '@lucide/svelte/icons/layers';
  import Bot from '@lucide/svelte/icons/bot';
  import Wrench from '@lucide/svelte/icons/wrench';

  let { part, streaming = false }: { part: Part; streaming?: boolean } = $props();

  let reasoningOpen = $state(false);
  let fileUrl = $state('');
  let lightbox = $state(false);

  $effect(() => {
    if (part.type !== 'file') return;
    const p = part as FilePart;
    if (/^(data:|https?:|blob:)/i.test(p.url)) {
      fileUrl = p.url;
    } else if (app.client) {
      fileUrl = app.client.url(p.url);
    } else {
      fileUrl = p.url;
    }
  });

  const reasoning = $derived(part.type === 'reasoning' ? (part as ReasoningPart) : null);
  const reasoningDuration = $derived(
    reasoning?.time?.end && reasoning?.time?.start ? formatDuration(reasoning.time.end - reasoning.time.start) : ''
  );

  $effect(() => {
    if (settings.showReasoning && reasoning) reasoningOpen = true;
  });
</script>

{#if part.type === 'text'}
  <div class="relative">
    <Markdown text={(part as TextPart).text} />
    {#if streaming}<span class="ml-0.5 inline-block h-[1.05em] w-[2px] animate-pulse rounded-full bg-tether align-[-0.15em]"></span>{/if}
  </div>
{:else if part.type === 'reasoning'}
  <div class="rounded-xl border border-border/50 bg-muted/20">
    <button
      type="button"
      class="flex w-full items-center gap-2 px-3 py-2 text-left text-[11.5px] text-muted-foreground hover:text-foreground"
      onclick={() => (reasoningOpen = !reasoningOpen)}
    >
      <Brain class="size-3.5 text-violet-300/70" />
      <span class="font-medium">{reasoningOpen ? 'Thinking' : 'Thought'}{reasoningDuration ? ` · ${reasoningDuration}` : ''}</span>
      {#if streaming}<span class="live-dot size-1.5 rounded-full bg-violet-300/80"></span>{/if}
      <ChevronRight class="ml-auto size-3.5 transition-transform {reasoningOpen ? 'rotate-90' : ''}" />
    </button>
    {#if reasoningOpen}
      <div class="border-t border-border/40 px-3 py-2.5 text-[12px] text-muted-foreground/90">
        <Markdown text={reasoning?.text ?? ''} />
      </div>
    {/if}
  </div>
{:else if part.type === 'tool'}
  <ToolCall {part} />
{:else if part.type === 'file'}
  {@const file = part as FilePart}
  {#if file.mime?.startsWith('image/')}
    <button type="button" class="block max-w-sm overflow-hidden rounded-xl border border-border/70" onclick={() => (lightbox = true)}>
      <img src={fileUrl} alt={file.filename ?? 'attachment'} class="max-h-72 w-auto object-contain" loading="lazy" />
    </button>
    {#if lightbox}
      <div class="fixed inset-0 z-[100] grid cursor-zoom-out place-items-center bg-black/85 p-4 backdrop-blur-sm" role="presentation" onclick={() => (lightbox = false)}>
        <img src={fileUrl} alt={file.filename ?? 'attachment'} class="max-h-[90dvh] max-w-full rounded-lg object-contain shadow-2xl" />
        <button type="button" class="absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-black/50 text-white/80 hover:text-white" onclick={() => (lightbox = false)} aria-label="Close image">×</button>
      </div>
    {/if}
  {:else}
    <a
      href={fileUrl}
      target="_blank"
      rel="noopener noreferrer"
      class="flex max-w-sm items-center gap-2.5 rounded-xl border border-border/70 bg-card/50 px-3 py-2 hover:border-border"
    >
      <span class="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><FileIcon class="size-4" /></span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-xs font-medium">{file.filename ?? 'attachment'}</span>
        <span class="block text-[10px] text-muted-foreground">{file.mime}</span>
      </span>
      <Download class="size-3.5 text-muted-foreground" />
    </a>
  {/if}
{:else if part.type === 'patch'}
  <div class="rounded-xl border border-border/60 bg-card/40 px-3 py-2">
    <div class="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
      <GitBranch class="size-3.5 text-emerald-400/80" /> Changed {part.files.length} file{part.files.length === 1 ? '' : 's'}
    </div>
    <div class="mt-1 flex flex-wrap gap-1.5">
      {#each part.files as file}
        <span class="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{file}</span>
      {/each}
    </div>
  </div>
{:else if part.type === 'compaction'}
  <div class="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
    <Layers class="size-3.5" /> Context compacted{part.auto ? ' automatically' : ''}
  </div>
{:else if part.type === 'retry'}
  <div class="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2 text-[11px] text-amber-200/80">
    <RotateCcw class="mt-0.5 size-3.5" />
    <span>Retrying (attempt {part.attempt})… {part.error?.data?.message ?? part.error?.message ?? ''}</span>
  </div>
{:else if part.type === 'agent'}
  <span class="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10.5px] text-muted-foreground">
    <Bot class="size-3" /> {part.name}
  </span>
{:else if part.type === 'subtask'}
  <details class="rounded-xl border border-border/60 bg-card/40 px-3 py-2">
    <summary class="cursor-pointer list-none text-[11px] text-muted-foreground">
      <span class="inline-flex items-center gap-1.5"><Wrench class="size-3" /> Subtask · {part.agent}</span>
      <span class="mt-1 block text-[12px] text-foreground/80">{part.description}</span>
    </summary>
    <div class="mt-2 border-t border-border/40 pt-2 text-[11px] text-muted-foreground"><Markdown text={part.prompt} /></div>
  </details>
{/if}
