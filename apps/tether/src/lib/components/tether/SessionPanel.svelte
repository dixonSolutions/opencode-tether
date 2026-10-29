<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { copyText, formatCost, formatTokens, projectName } from '$lib/platform';
  import { Root as Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import { Root as Progress } from '$lib/components/ui/progress/index.js';
  import { cn } from '$lib/utils';
  import { toast } from 'svelte-sonner';
  import X from '@lucide/svelte/icons/x';
  import ListTodo from '@lucide/svelte/icons/list-todo';
  import GitCompareArrows from '@lucide/svelte/icons/git-compare-arrows';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import Circle from '@lucide/svelte/icons/circle';
  import CircleX from '@lucide/svelte/icons/circle-x';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Copy from '@lucide/svelte/icons/copy';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import FileCode from '@lucide/svelte/icons/file-code';
  import FolderGit2 from '@lucide/svelte/icons/folder-git-2';

  let { onClose }: { onClose?: () => void } = $props();
  let tab = $state('todos');
  let expanded = $state<Record<string, boolean>>({});

  $effect(() => {
    if (app.selectedSessionId) {
      void app.refreshTodos();
      void app.refreshDiffs();
    }
  });

  const session = $derived(app.selectedSession);
  const todos = $derived(app.sessionTodos);
  const diffs = $derived(app.sessionDiffs);
  const completed = $derived(todos.filter((todo) => todo.status === 'completed').length);
  const progress = $derived(todos.length ? Math.round((completed / todos.length) * 100) : 0);
  const totalAdditions = $derived(diffs.reduce((sum, diff) => sum + (diff.additions ?? 0), 0));
  const totalDeletions = $derived(diffs.reduce((sum, diff) => sum + (diff.deletions ?? 0), 0));

  function toggle(file: string) {
    expanded = { ...expanded, [file]: !expanded[file] };
  }

  async function copyID() {
    if (!session) return;
    const ok = await copyText(session.id);
    toast[ok ? 'success' : 'error'](ok ? 'Session ID copied' : 'Could not copy');
  }
</script>

<aside class="flex h-full min-h-0 w-full flex-col border-l border-border/60 bg-sidebar/60">
  <div class="android-safe-top flex min-h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3">
    <span class="text-[11.5px] font-semibold">Session details</span>
    <button class="ml-auto grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" onclick={onClose} aria-label="Close session panel">
      <X class="size-3.5" />
    </button>
  </div>

  <Tabs.Root bind:value={tab} class="flex min-h-0 flex-1 flex-col">
    <Tabs.List class="mx-2 mt-2 grid w-auto grid-cols-2">
      <Tabs.Trigger value="todos" class="gap-1 text-[10px]"><ListTodo class="size-3" /> Todos {#if todos.length}<Badge variant="secondary" class="px-1 py-0 text-[8px]">{completed}/{todos.length}</Badge>{/if}</Tabs.Trigger>
      <Tabs.Trigger value="changes" class="gap-1 text-[10px]"><GitCompareArrows class="size-3" /> Changes {#if diffs.length}<Badge variant="secondary" class="px-1 py-0 text-[8px]">{diffs.length}</Badge>{/if}</Tabs.Trigger>
    </Tabs.List>

    <div class="tether-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
      <Tabs.Content value="todos" class="mt-0 space-y-2">
        {#if todos.length === 0}
          <div class="flex flex-col items-center px-4 py-10 text-center">
            <ListTodo class="size-5 text-muted-foreground/30" />
            <div class="mt-2 text-[10.5px] text-muted-foreground/60">No todo list for this session</div>
            <div class="mt-0.5 text-[9px] text-muted-foreground/40">opencode adds one when a task needs planning.</div>
          </div>
        {:else}
          <div class="rounded-lg border border-border/60 bg-card/30 p-2">
            <div class="flex items-center justify-between text-[9px] text-muted-foreground/60">
              <span>{completed} of {todos.length} complete</span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} class="mt-1 h-1" />
          </div>
          <div class="space-y-1">
            {#each todos as todo}
              <div class="flex items-start gap-2 rounded-lg px-1.5 py-1.5 hover:bg-muted/30">
                {#if todo.status === 'completed'}
                  <CircleCheck class="mt-0.5 size-3.5 shrink-0 text-emerald-400/80" />
                {:else if todo.status === 'in_progress'}
                  <Loader2 class="mt-0.5 size-3.5 shrink-0 animate-spin text-tether" />
                {:else if todo.status === 'cancelled'}
                  <CircleX class="mt-0.5 size-3.5 shrink-0 text-muted-foreground/40" />
                {:else}
                  <Circle class="mt-0.5 size-3.5 shrink-0 text-muted-foreground/35" />
                {/if}
                <span class={cn('min-w-0 flex-1 text-[10.5px] leading-relaxed', todo.status === 'completed' ? 'text-muted-foreground/50 line-through' : 'text-foreground/85')}>
                  {todo.content}
                </span>
                <span class={cn('mt-0.5 shrink-0 rounded px-1 py-0 text-[8px] uppercase tracking-wide', todo.priority === 'high' ? 'bg-red-500/10 text-red-300/70' : todo.priority === 'medium' ? 'bg-amber-500/10 text-amber-300/60' : 'text-muted-foreground/40')}>{todo.priority}</span>
              </div>
            {/each}
          </div>
        {/if}
      </Tabs.Content>

      <Tabs.Content value="changes" class="mt-0 space-y-2">
        {#if diffs.length === 0}
          <div class="flex flex-col items-center px-4 py-10 text-center">
            <FileCode class="size-5 text-muted-foreground/30" />
            <div class="mt-2 text-[10.5px] text-muted-foreground/60">No changed files</div>
            <div class="mt-0.5 text-[9px] text-muted-foreground/40">Changes made by opencode appear here.</div>
          </div>
        {:else}
          <div class="flex items-center justify-between rounded-lg border border-border/60 bg-card/30 px-2 py-1.5 text-[9px]">
            <span class="text-muted-foreground/60">{diffs.length} file{diffs.length === 1 ? '' : 's'}</span>
            <span>
              <span class="text-emerald-400/80">+{totalAdditions}</span>
              <span class="ml-1.5 text-red-400/80">−{totalDeletions}</span>
            </span>
          </div>
          {#each diffs as diff}
            <div class="overflow-hidden rounded-lg border border-border/60 bg-card/25">
              <button type="button" class="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/30" onclick={() => toggle(diff.file)}>
                <ChevronRight class={cn('size-3 shrink-0 text-muted-foreground/50 transition-transform', expanded[diff.file] && 'rotate-90')} />
                <span class="min-w-0 flex-1 truncate font-mono text-[10px]">{diff.file}</span>
                <span class="shrink-0 text-[9px]"><span class="text-emerald-400/80">+{diff.additions}</span> <span class="text-red-400/80">−{diff.deletions}</span></span>
              </button>
              {#if expanded[diff.file]}
                {#if diff.patch}
                  <div class="max-h-80 overflow-auto border-t border-border/50 bg-code/70 py-1 font-mono text-[9.5px] leading-[1.55]">
                    {#each diff.patch.split('\n') as line}
                      <div class={cn('whitespace-pre px-2', line.startsWith('+') && !line.startsWith('+++') ? 'bg-emerald-500/[0.09] text-emerald-300/90' : line.startsWith('-') && !line.startsWith('---') ? 'bg-red-500/[0.09] text-red-300/90' : line.startsWith('@@') ? 'text-sky-300/70' : 'text-muted-foreground/70')}>{line || ' '}</div>
                    {/each}
                  </div>
                {:else}
                  <div class="border-t border-border/50 px-2 py-2 text-[9.5px] text-muted-foreground/50">No patch preview available.</div>
                {/if}
              {/if}
            </div>
          {/each}
        {/if}
      </Tabs.Content>
    </div>
  </Tabs.Root>

  <div class="android-safe-bottom border-t border-border/60 px-3 py-2.5">
    {#if session}
      <div class="flex items-center gap-1.5 text-[9.5px] text-muted-foreground/60">
        <FolderGit2 class="size-3" />
        <span class="truncate">{session.directory ? projectName(session.directory) : 'global'}</span>
        <button class="ml-auto rounded p-0.5 hover:text-foreground" onclick={copyID} aria-label="Copy session ID"><Copy class="size-2.5" /></button>
      </div>
      <div class="mt-1 grid grid-cols-2 gap-1 text-[9px] text-muted-foreground/50">
        <span>{session.agent ?? 'build'} agent</span>
        <span class="truncate text-right">{session.model ? session.model.id : (app.selectedModel?.modelID ?? 'default model')}</span>
        <span>{formatTokens((session.tokens?.input ?? 0) + (session.tokens?.output ?? 0))} tokens</span>
        <span class="text-right">{formatCost(session.cost) || 'no cost yet'}</span>
      </div>
      <div class="mt-1 flex items-center justify-between text-[9px] text-muted-foreground/35">
        <span>created {new Date(session.time.created).toLocaleDateString()}</span>
        <button class="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground" onclick={() => app.refreshDiffs()}><RefreshCw class="size-2.5" /> refresh</button>
      </div>
    {:else}
      <div class="text-center text-[9.5px] text-muted-foreground/40">No session selected</div>
    {/if}
  </div>
</aside>
