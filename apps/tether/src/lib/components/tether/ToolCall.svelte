<script lang="ts">
  import type { ToolPart } from '$lib/api/types';
  import { settings } from '$lib/state/settings.svelte';
  import { copyText, formatDuration } from '$lib/platform';
  import { cn } from '$lib/utils';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Terminal from '@lucide/svelte/icons/terminal';
  import FilePenLine from '@lucide/svelte/icons/file-pen-line';
  import FilePlus2 from '@lucide/svelte/icons/file-plus-2';
  import FileText from '@lucide/svelte/icons/file-text';
  import FolderSearch from '@lucide/svelte/icons/folder-search';
  import Search from '@lucide/svelte/icons/search';
  import Globe from '@lucide/svelte/icons/globe';
  import ListChecks from '@lucide/svelte/icons/list-checks';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import Wrench from '@lucide/svelte/icons/wrench';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import CircleX from '@lucide/svelte/icons/circle-x';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';

  let { part }: { part: ToolPart } = $props();

  let expanded = $state(false);
  let copied = $state(false);

  const icons: Record<string, typeof Wrench> = {
    bash: Terminal,
    shell: Terminal,
    edit: FilePenLine,
    write: FilePlus2,
    read: FileText,
    glob: FolderSearch,
    grep: Search,
    list: FolderSearch,
    webfetch: Globe,
    websearch: Globe,
    task: ListChecks,
    todowrite: ListChecks,
    todoread: ListChecks,
    patch: GitBranch,
    multiedit: FilePenLine
  };

  const icon = $derived(icons[part.tool] ?? Wrench);
  const status = $derived(part.state.status);
  const input = $derived(part.state.status === 'pending' ? (part.state.input ?? {}) : part.state.input);
  const duration = $derived(
    part.state.status === 'completed' || part.state.status === 'error'
      ? part.state.time.end - part.state.time.start
      : part.state.status === 'running'
        ? Date.now() - part.state.time.start
        : 0
  );

  function firstString(...keys: string[]): string {
    for (const key of keys) {
      const value = (input as Record<string, unknown>)?.[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return '';
  }

  const summary = $derived.by(() => {
    if (part.state.status === 'completed' && part.state.title) return part.state.title;
    if (part.state.status === 'running' && part.state.title) return part.state.title;
    return firstString('command', 'filePath', 'path', 'pattern', 'url', 'description', 'query', 'prompt') || part.tool;
  });

  const subtitle = $derived.by(() => {
    const command = firstString('command');
    if (command && summary !== command) return command;
    const path = firstString('filePath', 'path');
    if (path && summary !== path) return path;
    return '';
  });

  const output = $derived.by(() => {
    if (part.state.status === 'completed') return part.state.output ?? '';
    if (part.state.status === 'error') return part.state.error ?? '';
    return '';
  });

  const outputPreview = $derived(output.length > 24_000 ? `${output.slice(0, 24_000)}\n… ${output.length - 24_000} more characters` : output);
  const inputJson = $derived(JSON.stringify(input ?? {}, null, 2));

  async function copyOutput() {
    const ok = await copyText(output);
    if (ok) {
      copied = true;
      setTimeout(() => (copied = false), 1400);
    }
  }

  $effect(() => {
    if (part.state.status === 'error') expanded = true;
    else if (settings.showToolDetails && (status === 'completed' || status === 'error')) expanded = true;
  });
</script>

<div
  class={cn(
    'group/tool overflow-hidden rounded-xl border transition-colors',
    status === 'error'
      ? 'border-red-500/25 bg-red-500/[0.035]'
      : status === 'running'
        ? 'border-tether/25 bg-tether/[0.035]'
        : 'border-border/70 bg-card/45 hover:border-border'
  )}
>
  <button
    type="button"
    class="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
    onclick={() => (expanded = !expanded)}
    aria-expanded={expanded}
  >
    <span
      class={cn(
        'mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border',
        status === 'error'
          ? 'border-red-500/20 bg-red-500/10 text-red-400'
          : status === 'running'
            ? 'border-tether/20 bg-tether/10 text-tether'
            : 'border-border/70 bg-muted/60 text-muted-foreground'
      )}
    >
      {#if status === 'running'}
        <Loader2 class="size-3.5 animate-spin" />
      {:else if status === 'error'}
        <CircleX class="size-3.5" />
      {:else}
        {@const Icon = icon}
        <Icon class="size-3.5" />
      {/if}
    </span>
    <span class="min-w-0 flex-1">
      <span class="flex items-center gap-1.5">
        <span class="truncate text-[13px] font-medium leading-5">{summary}</span>
        {#if status === 'completed'}
          <CircleCheck class="size-3 shrink-0 text-emerald-400/80" />
        {/if}
      </span>
      {#if subtitle}
        <span class="mt-0.5 block truncate font-mono text-[10.5px] leading-4 text-muted-foreground">{subtitle}</span>
      {/if}
      <span class="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
        <span>{part.tool}</span>
        {#if duration > 0}<span>· {formatDuration(duration)}</span>{/if}
        {#if status === 'error'}<span class="text-red-400/80">· failed</span>{/if}
      </span>
    </span>
    <ChevronRight class={cn('mt-1 size-3.5 shrink-0 text-muted-foreground/50 transition-transform', expanded && 'rotate-90')} />
  </button>

  {#if expanded}
    <div class="border-t border-border/60 bg-background/30 px-3 py-2.5">
      {#if status === 'error'}
        <div class="mb-2 rounded-lg border border-red-500/20 bg-red-500/[0.06] p-2 font-mono text-[11px] leading-relaxed text-red-300/90 whitespace-pre-wrap break-words">
          {outputPreview}
        </div>
      {:else if output}
        <div class="relative mb-2">
          <pre class="max-h-72 overflow-auto rounded-lg border border-border/60 bg-code p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85">{outputPreview}</pre>
          <button
            type="button"
            class="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md border border-border/70 bg-background/85 text-muted-foreground hover:text-foreground"
            onclick={copyOutput}
            aria-label="Copy output"
          >
            {#if copied}<Check class="size-3" />{:else}<Copy class="size-3" />{/if}
          </button>
        </div>
      {/if}
      <details class="group/input">
        <summary class="cursor-pointer list-none text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 hover:text-muted-foreground">
          Input
        </summary>
        <pre class="mt-1.5 max-h-56 overflow-auto rounded-lg border border-border/50 bg-code/60 p-2.5 font-mono text-[10.5px] leading-relaxed text-muted-foreground">{inputJson}</pre>
      </details>
    </div>
  {/if}
</div>
