<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { settings } from '$lib/state/settings.svelte';
  import SidebarContent from './SidebarContent.svelte';
  import ChatView from './ChatView.svelte';
  import SessionPanel from './SessionPanel.svelte';
  import RemotesSheet from './RemotesSheet.svelte';
  import SettingsSheet from './SettingsSheet.svelte';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import { tick } from 'svelte';

  let sidebarOpen = $state(false);
  let remotesOpen = $state(false);
  let settingsOpen = $state(false);
  let panelOpen = $state(false);
  let panelSheetOpen = $state(false);
  let desktop = $state(true);

  $effect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    desktop = query.matches;
    const onChange = (event: MediaQueryListEvent) => (desktop = event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  });

  function openPanel() {
    if (desktop) panelOpen = !panelOpen;
    else panelSheetOpen = true;
  }

  async function newSession() {
    await app.newSession();
    await tick();
  }

  function onKeydown(event: KeyboardEvent) {
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
  <div class="hidden w-[288px] shrink-0 border-r border-border/60 lg:flex">
      <SidebarContent
        onOpenRemotes={() => (remotesOpen = true)}
        onOpenSettings={() => (settingsOpen = true)}
        onNavigate={() => {}}
      />
  </div>

  <main class="flex min-w-0 flex-1 flex-col">
    <ChatView
      onOpenSidebar={() => (sidebarOpen = true)}
      onOpenPanel={openPanel}
      {panelOpen}
      {panelCount}
    />
  </main>

  {#if desktop && panelOpen}
    <div class="hidden w-[344px] shrink-0 lg:block">
      <SessionPanel onClose={() => (panelOpen = false)} />
    </div>
  {/if}
</div>

<Sheet.Root bind:open={sidebarOpen}>
  <Sheet.Content side="left" class="w-[86%] max-w-[330px] gap-0 border-r border-border/60 p-0">
    <SidebarContent
      onOpenRemotes={() => {
        sidebarOpen = false;
        setTimeout(() => (remotesOpen = true), 160);
      }}
      onOpenSettings={() => {
        sidebarOpen = false;
        setTimeout(() => (settingsOpen = true), 160);
      }}
      onNavigate={() => (sidebarOpen = false)}
    />
  </Sheet.Content>
</Sheet.Root>

<Sheet.Root bind:open={panelSheetOpen}>
  <Sheet.Content side="right" class="w-full max-w-full gap-0 p-0 sm:max-w-md">
    <SessionPanel onClose={() => (panelSheetOpen = false)} />
  </Sheet.Content>
</Sheet.Root>

<RemotesSheet bind:open={remotesOpen} />
<SettingsSheet bind:open={settingsOpen} onOpenRemotes={() => (remotesOpen = true)} />
