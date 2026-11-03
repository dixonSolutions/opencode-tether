<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import SidebarContent from './SidebarContent.svelte';
  import ChatView from './ChatView.svelte';
  import SessionPanel from './SessionPanel.svelte';
  import RemotesSheet from './RemotesSheet.svelte';
  import SettingsSheet from './SettingsSheet.svelte';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import { swipe } from '$lib/gestures';
  import { tick } from 'svelte';

  let sidebarOpen = $state(false);
  let remotesOpen = $state(false);
  let settingsOpen = $state(false);
  let panelOpen = $state(false);
  let panelSheetOpen = $state(false);
  let desktop = $state(true);
  let wide = $state(true);

  $effect(() => {
    const desktopQuery = window.matchMedia('(min-width: 1024px)');
    const wideQuery = window.matchMedia('(min-width: 1280px)');
    desktop = desktopQuery.matches;
    wide = wideQuery.matches;
    const sync = () => {
      desktop = desktopQuery.matches;
      wide = wideQuery.matches;
      if (desktop) {
        sidebarOpen = false;
        panelSheetOpen = false;
      } else {
        panelOpen = false;
      }
    };
    desktopQuery.addEventListener('change', sync);
    wideQuery.addEventListener('change', sync);
    return () => {
      desktopQuery.removeEventListener('change', sync);
      wideQuery.removeEventListener('change', sync);
    };
  });

  function openSidebarBySwipe() {
    if (desktop || sidebarOpen) return;
    app.haptic(6);
    sidebarOpen = true;
  }

  function openPanel() {
    if (wide) panelOpen = !panelOpen;
    else panelSheetOpen = true;
  }

  async function newSession() {
    await app.newSession();
    await tick();
  }

  async function fromSidebar(open: () => void) {
    sidebarOpen = false;
    await tick();
    open();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      sidebarOpen = false;
      panelSheetOpen = false;
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    if (event.key.toLowerCase() === 'n') {
      event.preventDefault();
      void newSession();
    } else if (event.key === ',') {
      event.preventDefault();
      settingsOpen = true;
    } else if (event.key.toLowerCase() === 'b' && desktop) {
      event.preventDefault();
      sidebarOpen = !sidebarOpen;
    }
  }

  const panelCount = $derived(app.sessionTodos.filter((todo) => todo.status !== 'completed' && todo.status !== 'cancelled').length + app.sessionDiffs.length);
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app-height flex w-full overflow-hidden bg-background">
  <div class="hidden w-[320px] shrink-0 border-r border-border/60 xl:w-[336px] lg:flex">
      <SidebarContent
        onOpenRemotes={() => (remotesOpen = true)}
        onOpenSettings={() => (settingsOpen = true)}
        onNavigate={() => {}}
      />
  </div>

  <main class="flex min-w-0 flex-1 flex-col" use:swipe={{ onSwipeRight: openSidebarBySwipe }}>
    <ChatView
      onOpenSidebar={() => (sidebarOpen = true)}
      onOpenPanel={openPanel}
      {panelOpen}
      {panelCount}
    />
  </main>

  {#if wide && panelOpen}
    <div class="hidden w-[380px] shrink-0 xl:block 2xl:w-[420px]">
      <SessionPanel onClose={() => (panelOpen = false)} />
    </div>
  {/if}
</div>

<Sheet.Root bind:open={sidebarOpen}>
  <Sheet.Content side="left" showCloseButton={false} class="safe-x w-[92%] max-w-[400px] gap-0 border-r border-border/60 p-0 sm:max-w-[420px]">
    <Sheet.Title class="sr-only">Sessions and navigation</Sheet.Title>
    <Sheet.Description class="sr-only">Browse sessions, change the folder, or open settings and remotes.</Sheet.Description>
    <div class="h-full" use:swipe={{ onSwipeLeft: () => (sidebarOpen = false) }}>
      <SidebarContent
        onOpenRemotes={() => void fromSidebar(() => (remotesOpen = true))}
        onOpenSettings={() => void fromSidebar(() => (settingsOpen = true))}
        onNavigate={() => (sidebarOpen = false)}
        onClose={() => (sidebarOpen = false)}
      />
    </div>
  </Sheet.Content>
</Sheet.Root>

<Sheet.Root bind:open={panelSheetOpen}>
  <Sheet.Content side="left" showCloseButton={false} class="safe-x w-[92%] max-w-[420px] gap-0 border-r border-border/60 p-0 sm:max-w-[440px]">
    <Sheet.Title class="sr-only">Session details</Sheet.Title>
    <Sheet.Description class="sr-only">Todos and changed files for the current session.</Sheet.Description>
    <div class="h-full" use:swipe={{ onSwipeLeft: () => (panelSheetOpen = false) }}>
      <SessionPanel onClose={() => (panelSheetOpen = false)} />
    </div>
  </Sheet.Content>
</Sheet.Root>

<RemotesSheet bind:open={remotesOpen} />
<SettingsSheet bind:open={settingsOpen} onOpenRemotes={() => (remotesOpen = true)} />
