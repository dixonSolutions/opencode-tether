<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { settings, type ThemeMode, type SendKey } from '$lib/state/settings.svelte';
  import { persistentStore } from '$lib/storage.svelte';
  import { APP_VERSION, GITHUB_URL, OPENCODE_URL } from '$lib/constants';
  import { copyText, isAndroid, isFlatpak, isTauri, openExternal, requestNotificationPermission } from '$lib/platform';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import { Root as Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Root as Separator } from '$lib/components/ui/separator/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import ToggleRow from './ToggleRow.svelte';
  import UpdatePanel from './UpdatePanel.svelte';
  import Brand from './Brand.svelte';
  import StatusDot from './StatusDot.svelte';
  import { setMode } from 'mode-watcher';
  import { cn } from '$lib/utils';
  import { toast } from 'svelte-sonner';
  import Settings from '@lucide/svelte/icons/settings';
  import Server from '@lucide/svelte/icons/server';
  import Download from '@lucide/svelte/icons/download';
  import Info from '@lucide/svelte/icons/info';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';
  import Monitor from '@lucide/svelte/icons/monitor';
  import LogOut from '@lucide/svelte/icons/log-out';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Code2 from '@lucide/svelte/icons/code-2';
  import Heart from '@lucide/svelte/icons/heart';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Copy from '@lucide/svelte/icons/copy';
  import Smartphone from '@lucide/svelte/icons/smartphone';

  let { open = $bindable(false), onOpenRemotes }: { open?: boolean; onOpenRemotes?: () => void } = $props();
  let tab = $state('general');
  let platform = $state('');
  let resetting = $state(false);

  $effect(() => {
    if (!open) return;
    void detectPlatform();
  });

  async function detectPlatform() {
    if (await isAndroid()) platform = 'Android';
    else if (await isFlatpak()) platform = 'Flatpak';
    else if (isTauri()) platform = 'Desktop';
    else platform = 'Web';
  }

  function applyTheme(theme: ThemeMode) {
    settings.setTheme(theme);
    setMode(theme);
  }

  function setSendKey(key: SendKey) {
    settings.sendKey = key;
  }

  async function toggleNotifications(next: boolean) {
    if (next) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        toast.warning('Notifications are blocked', { description: 'Allow notifications in your browser or system settings.' });
        settings.notifications = false;
        return;
      }
    }
    settings.notifications = next;
  }

  function manageRemotes() {
    open = false;
    setTimeout(() => onOpenRemotes?.(), 180);
  }

  async function resetLocal() {
    if (!confirm('Reset all opencode-tether settings and saved hosts on this device? This cannot be undone.')) return;
    resetting = true;
    try {
      await persistentStore.reset();
      localStorage.removeItem('opencode-tether.store.v1');
      localStorage.removeItem('opencode-tether.host');
      location.reload();
    } catch {
      resetting = false;
      toast.error('Could not reset local data');
    }
  }

  async function copyHostInfo() {
    const info = `${app.activeRemote?.name ?? 'host'} · ${app.activeRemote?.url ?? location.origin} · opencode ${app.connection.version ?? app.host?.upstream.version ?? '?'}`;
    const ok = await copyText(info);
    toast[ok ? 'success' : 'error'](ok ? 'Host info copied' : 'Could not copy');
  }
</script>

<Sheet.Root bind:open>
  <Sheet.Content side="right" class="w-full max-w-full gap-0 p-0 sm:max-w-md">
    <Sheet.Header class="android-safe-top border-b border-border/60 px-4 pb-2 pt-4">
      <Sheet.Title class="flex items-center gap-2 text-sm"><Settings class="size-4 text-tether" /> Settings</Sheet.Title>
      <Sheet.Description class="sr-only">opencode-tether preferences, hosts, updates, and about.</Sheet.Description>
    </Sheet.Header>

    <Tabs.Root bind:value={tab} class="flex min-h-0 flex-1 flex-col">
      <Tabs.List class="mx-3 mt-2 grid w-auto grid-cols-4">
        <Tabs.Trigger value="general" class="text-[10.5px]">General</Tabs.Trigger>
        <Tabs.Trigger value="hosts" class="text-[10.5px]">Host</Tabs.Trigger>
        <Tabs.Trigger value="updates" class="text-[10.5px]">Updates</Tabs.Trigger>
        <Tabs.Trigger value="about" class="text-[10.5px]">About</Tabs.Trigger>
      </Tabs.List>

      <div class="android-safe-bottom tether-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-2">
        <Tabs.Content value="general" class="space-y-3">
          <section class="rounded-xl border border-border/60 bg-card/30 p-3">
            <h3 class="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">Appearance</h3>
            <div class="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-border/60 bg-muted/30 p-0.5">
              <button type="button" class={cn('flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10.5px] font-medium transition-colors', settings.theme === 'dark' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')} onclick={() => applyTheme('dark')}>
                <Moon class="size-3" /> Dark
              </button>
              <button type="button" class={cn('flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10.5px] font-medium transition-colors', settings.theme === 'light' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')} onclick={() => applyTheme('light')}>
                <Sun class="size-3" /> Light
              </button>
              <button type="button" class={cn('flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10.5px] font-medium transition-colors', settings.theme === 'system' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')} onclick={() => applyTheme('system')}>
                <Monitor class="size-3" /> System
              </button>
            </div>
          </section>

          <section class="rounded-xl border border-border/60 bg-card/30 p-3">
            <h3 class="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">Composer</h3>
            <div class="mt-2 flex items-center justify-between gap-2">
              <span>
                <span class="block text-[11.5px] font-medium">Send with</span>
                <span class="block text-[9.5px] text-muted-foreground/60">How Enter behaves in the message box</span>
              </span>
              <div class="flex shrink-0 rounded-lg border border-border/60 bg-muted/30 p-0.5">
                <button class={cn('rounded-md px-2 py-1 text-[10px]', settings.sendKey === 'enter' ? 'bg-background shadow-sm' : 'text-muted-foreground')} onclick={() => setSendKey('enter')}>Enter</button>
                <button class={cn('rounded-md px-2 py-1 text-[10px]', settings.sendKey === 'mod-enter' ? 'bg-background shadow-sm' : 'text-muted-foreground')} onclick={() => setSendKey('mod-enter')}>⌘ Enter</button>
              </div>
            </div>
            <Separator class="my-1" />
            <ToggleRow label="Auto-scroll" description="Follow new output unless you scroll up" bind:checked={settings.autoScroll} />
            <ToggleRow label="Reconnect automatically" description="Reconnect the event stream when the connection drops" bind:checked={settings.autoReconnect} />
            <ToggleRow label="Notifications" description="Notify when a response finishes or input is needed" checked={settings.notifications} onChange={toggleNotifications} />
          </section>

          <section class="rounded-xl border border-border/60 bg-card/30 p-3">
            <h3 class="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">Messages</h3>
            <ToggleRow label="Show reasoning expanded" description="Open the thinking block by default" bind:checked={settings.showReasoning} />
            <ToggleRow label="Expand tool output" description="Show tool input and output automatically" bind:checked={settings.showToolDetails} />
            <ToggleRow label="Show timestamps" description="Display message times" bind:checked={settings.showTimestamps} />
            <ToggleRow label="Haptic feedback" description="Short vibration on actions where supported" bind:checked={settings.haptics} />
          </section>

          <button type="button" class="flex w-full items-center justify-between rounded-xl border border-border/50 bg-card/20 px-3 py-2 text-left hover:border-border" onclick={resetLocal} disabled={resetting}>
            <span>
              <span class="block text-[11px] font-medium text-red-300/90">Reset local data</span>
              <span class="block text-[9.5px] text-muted-foreground/50">Forget hosts, credentials, drafts, and preferences</span>
            </span>
            <Trash2 class="size-3.5 text-red-300/60" />
          </button>
        </Tabs.Content>

        <Tabs.Content value="hosts" class="space-y-3">
          <section class="rounded-xl border border-border/60 bg-card/30 p-3">
            <div class="flex items-start gap-2.5">
              <span class="grid size-9 shrink-0 place-items-center rounded-lg border border-border/60 bg-muted/40"><Server class="size-4 text-tether" /></span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="truncate text-[12px] font-semibold">{app.hostMode ? 'opencode-tether host' : (app.activeRemote?.name ?? 'No host')}</span>
                  <StatusDot state={app.connection.state} size={6} />
                </div>
                <div class="mt-0.5 truncate font-mono text-[9.5px] text-muted-foreground/60">{app.hostMode ? location.origin : (app.activeRemote?.url ?? '—')}</div>
                <div class="mt-1.5 grid grid-cols-2 gap-1.5 text-[9.5px] text-muted-foreground/60">
                  <div>opencode <span class="text-foreground/80">{app.connection.version ?? app.host?.upstream.version ?? '—'}</span></div>
                  <div>latency <span class="text-foreground/80">{app.connection.latencyMs ?? '—'}ms</span></div>
                  <div>tether <span class="text-foreground/80">{app.hostMode ? (app.host?.version ?? APP_VERSION) : APP_VERSION}</span></div>
                  <div>events <span class="text-foreground/80">{app.eventState}</span></div>
                </div>
              </div>
              <button class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onclick={copyHostInfo} title="Copy host info" aria-label="Copy host info"><Copy class="size-3" /></button>
            </div>
            <div class="mt-2.5 flex flex-wrap gap-1.5">
              {#if app.hostMode}
                <Badge variant="outline" class="border-tether/25 text-[8.5px] text-tether">host mode</Badge>
                <Badge variant="secondary" class="text-[8.5px]">no remote switching</Badge>
              {:else}
                <Button variant="outline" size="sm" class="h-7 gap-1 text-[10.5px]" onclick={manageRemotes}><Server class="size-3" /> Manage remotes</Button>
                <Button variant="ghost" size="sm" class="h-7 gap-1 text-[10.5px]" onclick={() => app.retry()}><RefreshCw class="size-3" /> Reconnect</Button>
              {/if}
            </div>
          </section>

          {#if app.hostMode}
            <section class="rounded-xl border border-border/60 bg-card/30 p-3 text-[10px] leading-relaxed text-muted-foreground">
              <div class="font-medium text-foreground/80">This host is the application</div>
              <p class="mt-1">This page is served by the Rust host shim, which launches the configured opencode web command and proxies its API behind one login. Remotes are disabled in host mode by design.</p>
              <p class="mt-1.5">Signed in as <span class="font-mono text-foreground/80">{app.hostAuth?.username ?? 'host user'}</span>.</p>
              <Button variant="outline" size="sm" class="mt-2 h-7 gap-1 text-[10.5px]" onclick={() => app.logoutHost()}><LogOut class="size-3" /> Sign out</Button>
            </section>
          {:else}
            <section class="rounded-xl border border-border/60 bg-card/30 p-3 text-[10px] leading-relaxed text-muted-foreground">
              <div class="font-medium text-foreground/80">Remote management</div>
              <p class="mt-1">Remotes, credentials, default selection, and the last used host are managed in the Remotes panel. The last used host opens automatically next launch.</p>
            </section>
          {/if}
          <div class="flex items-center justify-between rounded-xl border border-border/50 bg-card/20 px-3 py-2 text-[9.5px] text-muted-foreground/50">
            <span class="inline-flex items-center gap-1"><Smartphone class="size-3" /> {platform || 'Web'} build</span>
            <span>opencode-tether {APP_VERSION}</span>
          </div>
        </Tabs.Content>

        <Tabs.Content value="updates">
          <UpdatePanel />
        </Tabs.Content>

        <Tabs.Content value="about" class="space-y-3">
          <div class="flex flex-col items-center rounded-xl border border-border/60 bg-card/30 px-4 py-5 text-center">
            <Brand size={56} wordmark />
            <Badge variant="outline" class="mt-2 px-2 py-0 text-[8.5px] uppercase tracking-[0.12em]">unofficial · hobby project</Badge>
            <p class="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
              A native-feeling, mobile-first remote for opencode. Not affiliated with or endorsed by the opencode project.
            </p>
          </div>
          <div class="space-y-1 rounded-xl border border-border/60 bg-card/30 p-2">
            <a class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] hover:bg-muted" href={GITHUB_URL} onclick={(event) => { event.preventDefault(); void openExternal(GITHUB_URL); }}>
              <Code2 class="size-3.5" /> Project repository <ExternalLink class="ml-auto size-3 text-muted-foreground/50" />
            </a>
            <a class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] hover:bg-muted" href={OPENCODE_URL} onclick={(event) => { event.preventDefault(); void openExternal(OPENCODE_URL); }}>
              <ExternalLink class="size-3.5" /> opencode <span class="ml-auto text-[9px] text-muted-foreground/50">opencode.ai</span>
            </a>
          </div>
          <div class="rounded-xl border border-border/60 bg-card/30 p-3 text-[9.5px] leading-relaxed text-muted-foreground/60">
            <div class="flex items-center gap-1 text-[10.5px] font-medium text-foreground/80"><Info class="size-3.5" /> Details</div>
            <div class="mt-1.5 space-y-0.5">
              <div>Version <span class="text-foreground/70">{APP_VERSION}</span></div>
              <div>License <span class="text-foreground/70">MIT</span></div>
              <div>Built with SvelteKit, shadcn-svelte, Tauri, and Rust.</div>
              <div>opencode is a separate project and keeps its own license and trademarks.</div>
            </div>
          </div>
          <div class="flex items-center justify-center gap-1 py-2 text-[9.5px] text-muted-foreground/40">
            Made with <Heart class="size-3 text-tether/70" /> for the opencode community
          </div>
        </Tabs.Content>
      </div>
    </Tabs.Root>
  </Sheet.Content>
</Sheet.Root>
