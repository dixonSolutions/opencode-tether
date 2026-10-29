<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import Brand from './Brand.svelte';
  import StatusDot from './StatusDot.svelte';
  import MessageView from './MessageView.svelte';
  import Composer from './Composer.svelte';
  import TerminalSheet from './TerminalSheet.svelte';
  import PermissionCard from './PermissionCard.svelte';
  import QuestionCard from './QuestionCard.svelte';
  import { Root as Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Root as Skeleton } from '$lib/components/ui/skeleton/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Root as Input } from '$lib/components/ui/input/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import { cn } from '$lib/utils';
  import { copyText, formatCost, projectName } from '$lib/platform';
  import { toast } from 'svelte-sonner';
  import { tick } from 'svelte';
  import Menu from '@lucide/svelte/icons/menu';
  import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
  import Plus from '@lucide/svelte/icons/plus';
  import PanelRight from '@lucide/svelte/icons/panel-right';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Copy from '@lucide/svelte/icons/copy';
  import Share2 from '@lucide/svelte/icons/share-2';
  import GitFork from '@lucide/svelte/icons/git-fork';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Terminal from '@lucide/svelte/icons/terminal';
  import Bug from '@lucide/svelte/icons/bug';
  import TestTube2 from '@lucide/svelte/icons/test-tube-2';
  import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
  import WifiOff from '@lucide/svelte/icons/wifi-off';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';

  let {
    onOpenSidebar,
    onOpenPanel,
    panelOpen = false,
    panelCount = 0
  }: {
    onOpenSidebar: () => void;
    onOpenPanel: () => void;
    panelOpen?: boolean;
    panelCount?: number;
  } = $props();

  let scroller: HTMLDivElement;
  let stick = $state(true);
  let renameOpen = $state(false);
  let renameValue = $state('');
  let deleting = $state(false);
  let terminalOpen = $state(false);

  const session = $derived(app.selectedSession);
  const title = $derived(session?.title || (session ? 'Untitled session' : 'New session'));
  const busy = $derived(app.isBusy);
  const signature = $derived(
    `${app.messages.length}:${app.messages.at(-1)?.parts.length ?? 0}:${
      (() => {
        const last = app.messages.at(-1)?.parts.at(-1);
        return last && 'text' in last ? last.text.length : 0;
      })()
    }:${busy}`
  );

  $effect(() => {
    signature;
    app.selectedSessionId;
    if (!scroller) return;
    if (stick) {
      requestAnimationFrame(() => scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'instant' as ScrollBehavior }));
    }
  });

  $effect(() => {
    app.selectedSessionId;
    requestAnimationFrame(() => {
      stick = true;
      scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'instant' as ScrollBehavior });
    });
  });

  function onScroll() {
    if (!scroller) return;
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
  }

  function jumpToLatest() {
    stick = true;
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
  }

  async function newSession() {
    await app.newSession();
    await tick();
    jumpToLatest();
  }

  function openRename() {
    renameValue = session?.title ?? '';
    renameOpen = true;
  }

  async function submitRename() {
    if (!app.selectedSessionId || !renameValue.trim()) return;
    await app.renameSession(app.selectedSessionId, renameValue.trim());
    renameOpen = false;
  }

  async function deleteCurrent() {
    if (!app.selectedSessionId) return;
    if (!confirm('Delete this session? This cannot be undone.')) return;
    deleting = true;
    await app.deleteSession(app.selectedSessionId);
    deleting = false;
  }

  async function copyLink() {
    if (!app.selectedSessionId) return;
    const url = new URL(window.location.href);
    url.searchParams.set('session', app.selectedSessionId);
    const ok = await copyText(url.toString());
    toast[ok ? 'success' : 'error'](ok ? 'Session link copied' : 'Could not copy link');
  }

  async function copyID() {
    if (!app.selectedSessionId) return;
    const ok = await copyText(app.selectedSessionId);
    toast[ok ? 'success' : 'error'](ok ? 'Session ID copied' : 'Could not copy');
  }

  async function sendSuggestion(prompt: string) {
    const ok = await app.sendPrompt({ text: prompt });
    if (ok) jumpToLatest();
  }

  const suggestions = [
    { icon: Sparkles, title: 'Explain this codebase', text: 'Give me a high-level tour of this repository: the stack, the main entry points, and where the important logic lives.' },
    { icon: Bug, title: 'Find and fix a bug', text: 'Find the most likely bug in the current project. Explain it, then fix it and run the relevant tests.' },
    { icon: TestTube2, title: 'Write tests', text: 'Look at the current project and add focused tests for the least-tested code path. Run them when done.' },
    { icon: GitPullRequest, title: 'Review my changes', text: 'Review the current uncommitted changes. Call out bugs, regressions, and anything I should fix before committing.' }
  ];
</script>

<section class="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
  <header class="android-safe-top android-no-blur flex min-h-12 shrink-0 items-center gap-1.5 border-b border-border/60 bg-background/80 px-1.5 backdrop-blur-xl sm:min-h-13 sm:px-3">
    <Button variant="ghost" size="icon-sm" class="lg:hidden" onclick={onOpenSidebar} aria-label="Open sessions">
      <Menu class="size-4" />
    </Button>
    <div class="min-w-0 flex-1 pl-0.5">
      <div class="flex items-center gap-1.5">
        <h1 class="truncate text-[12.5px] font-semibold tracking-tight sm:text-[13px]">{title}</h1>
        {#if busy}
          <span class="hidden items-center gap-1 rounded-full border border-tether/20 bg-tether/10 px-1.5 py-0.5 text-[8.5px] font-medium uppercase tracking-wide text-tether sm:inline-flex">
            <span class="live-dot size-1 rounded-full bg-tether"></span> working
          </span>
        {/if}
      </div>
      <div class="flex min-w-0 items-center gap-1.5 text-[9.5px] text-muted-foreground/60">
        <StatusDot state={app.connection.state === 'online' ? 'online' : app.connection.state} size={5} />
        <span class="truncate">
          {#if app.connection.state === 'online' || app.connection.state === 'idle'}
            {app.connection.latencyMs ? `${app.connection.latencyMs}ms` : 'online'}{app.eventState === 'live' ? ' · live' : app.eventState === 'reconnecting' ? ' · reconnecting' : ''}
          {:else if app.connection.state === 'unauthorized'}
            sign in required
          {:else if app.connection.state === 'offline'}
            offline
          {:else}
            connecting
          {/if}
          {#if session?.directory}<span class="hidden sm:inline"> · {projectName(session.directory)}</span>{/if}
        </span>
      </div>
    </div>

    <Button variant="ghost" size="icon-sm" class="hidden sm:inline-flex" onclick={newSession} title="New session">
      <Plus class="size-4" />
    </Button>
    <Button variant="ghost" size="icon-sm" class={cn(panelOpen && 'bg-muted text-foreground')} onclick={onOpenPanel} title="Session panel" aria-label="Toggle session panel">
      <PanelRight class="size-4" />
      {#if panelCount > 0}<span class="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-tether"></span>{/if}
    </Button>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button variant="ghost" size="icon-sm" {...props} aria-label="Session actions">
            <MoreHorizontal class="size-4" />
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-48">
        <DropdownMenu.Item onclick={openRename} disabled={!session}><Pencil class="size-3.5" /> Rename</DropdownMenu.Item>
        <DropdownMenu.Item onclick={() => (terminalOpen = true)} disabled={!session}><Terminal class="size-3.5" /> Terminal</DropdownMenu.Item>
        <DropdownMenu.Item onclick={() => app.shareSession()} disabled={!session}><Share2 class="size-3.5" /> Share</DropdownMenu.Item>
        <DropdownMenu.Item onclick={() => app.forkSession()} disabled={!session}><GitFork class="size-3.5" /> Fork</DropdownMenu.Item>
        <DropdownMenu.Item onclick={() => app.summarizeSession()} disabled={!session}><Sparkles class="size-3.5" /> Summarize</DropdownMenu.Item>
        <DropdownMenu.Item onclick={copyLink} disabled={!session}><Copy class="size-3.5" /> Copy link</DropdownMenu.Item>
        <DropdownMenu.Item onclick={copyID} disabled={!session}><Terminal class="size-3.5" /> Copy session ID</DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item onclick={() => app.refreshMessages()}><RefreshCw class="size-3.5" /> Refresh messages</DropdownMenu.Item>
        <DropdownMenu.Item onclick={() => app.refreshAll()}><ShieldCheck class="size-3.5" /> Refresh host data</DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item onclick={deleteCurrent} disabled={!session || deleting} class="text-red-400">
          <Trash2 class="size-3.5" /> Delete session
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </header>

  {#if app.connection.state === 'offline' || app.connection.state === 'unauthorized'}
    <div class="flex shrink-0 items-center justify-center gap-2 border-b border-red-500/20 bg-red-500/[0.06] px-3 py-1.5 text-[10.5px] text-red-300/90">
      <WifiOff class="size-3" />
      <span class="truncate">{app.connection.error ?? app.lastError ?? 'Connection lost'}</span>
      <button class="ml-1 rounded px-1.5 py-0.5 font-medium underline underline-offset-2 hover:bg-red-500/10" onclick={() => app.retry()}>Reconnect</button>
    </div>
  {/if}

  <div class="relative flex min-h-0 flex-1 flex-col">
    <div bind:this={scroller} onscroll={onScroll} class="tether-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth">
      <div class="mx-auto w-full max-w-3xl px-3 pb-6 pt-4 sm:px-5 sm:pt-6">
        {#if app.messagesLoading && app.messages.length === 0}
          <div class="space-y-5 py-4">
            <div class="flex gap-2"><Skeleton class="size-5 rounded-md" /><div class="flex-1 space-y-2"><Skeleton class="h-3 w-24" /><Skeleton class="h-3 w-full" /><Skeleton class="h-3 w-4/5" /></div></div>
            <div class="flex justify-end"><Skeleton class="h-12 w-2/3 rounded-2xl" /></div>
            <div class="flex gap-2"><Skeleton class="size-5 rounded-md" /><div class="flex-1 space-y-2"><Skeleton class="h-3 w-32" /><Skeleton class="h-20 w-full rounded-xl" /></div></div>
          </div>
        {:else if app.messages.length === 0}
          <div class="flex min-h-[52dvh] flex-col items-center justify-center py-8 text-center">
            <Brand size={52} />
            <h2 class="mt-4 text-balance text-lg font-semibold tracking-tight sm:text-xl">
              {session ? 'Start the conversation' : 'What are we building?'}
            </h2>
            <p class="mt-1 max-w-sm text-balance text-[12px] leading-relaxed text-muted-foreground">
              {#if session}
                Send a message to <span class="text-foreground/80">{title}</span>. Use <code class="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">/</code> for commands or <code class="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">!</code> to run a shell command.
              {:else}
                A new session will be created on your connected opencode host when you send your first message.
              {/if}
            </p>
            <div class="mt-5 grid w-full max-w-lg grid-cols-1 gap-1.5 sm:grid-cols-2">
              {#each suggestions as suggestion}
                {@const SuggestionIcon = suggestion.icon}
                <button
                  type="button"
                  class="group flex items-start gap-2 rounded-xl border border-border/60 bg-card/40 px-3 py-2 text-left transition-colors hover:border-border hover:bg-card/70"
                  onclick={() => sendSuggestion(suggestion.text)}
                >
                  <SuggestionIcon class="mt-0.5 size-3.5 text-tether/80" />
                  <span class="text-[11.5px] font-medium text-foreground/85">{suggestion.title}</span>
                </button>
              {/each}
            </div>
            {#if app.connection.busySessions}
              <div class="mt-4 text-[10px] text-muted-foreground/50">{app.connection.busySessions} session{app.connection.busySessions === 1 ? '' : 's'} busy on this host</div>
            {/if}
          </div>
        {:else}
          <div class="space-y-6 sm:space-y-7">
            {#each app.messages as message, index (message.info.id)}
              <MessageView {message} isLast={index === app.messages.length - 1} />
            {/each}
          </div>
        {/if}

        {#if app.selectedStatus.type === 'retry'}
          <div class="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2 text-[11px] text-amber-200/80">
            Retrying in {Math.max(0, Math.round((app.selectedStatus.next - Date.now()) / 1000))}s · {app.selectedStatus.message}
          </div>
        {/if}
      </div>
    </div>

    {#if !stick && app.messages.length > 0}
      <button
        type="button"
        class="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border/80 bg-popover/95 px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground shadow-xl backdrop-blur-xl hover:text-foreground"
        onclick={jumpToLatest}
      >
        <ArrowDown class="size-3" /> Jump to latest
      </button>
    {/if}

    {#if app.sessionPermissions.length || app.sessionQuestions.length}
      <div class="tether-scroll max-h-[44dvh] shrink-0 space-y-1.5 overflow-y-auto border-t border-border/60 bg-background/60 px-2.5 pt-2 backdrop-blur sm:px-4">
        {#each app.sessionQuestions as question (question.id)}
          <QuestionCard request={question} />
        {/each}
        {#each app.sessionPermissions as permission (permission.id)}
          <PermissionCard request={permission} />
        {/each}
      </div>
    {/if}

    <Composer />
  </div>
</section>

<TerminalSheet bind:open={terminalOpen} />

<Dialog.Root bind:open={renameOpen}>
  <Dialog.Content class="sm:max-w-sm">
    <Dialog.Header>
      <Dialog.Title class="text-sm">Rename session</Dialog.Title>
      <Dialog.Description class="text-xs text-muted-foreground">A short, descriptive title appears in the session list.</Dialog.Description>
    </Dialog.Header>
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void submitRename();
      }}
    >
      <Input bind:value={renameValue} placeholder="Session title" autofocus />
      <Dialog.Footer class="mt-4">
        <Button variant="ghost" size="sm" type="button" onclick={() => (renameOpen = false)}>Cancel</Button>
        <Button size="sm" type="submit" disabled={!renameValue.trim()}>Save</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
