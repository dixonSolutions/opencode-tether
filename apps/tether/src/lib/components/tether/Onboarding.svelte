<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { settings } from '$lib/state/settings.svelte';
  import { normalizeBaseUrl } from '$lib/api/client';
  import { testRemote } from '$lib/api/health';
  import { DOCS_URL, OPENCODE_URL } from '$lib/constants';
  import { openExternal, relativeTime } from '$lib/platform';
  import Brand from './Brand.svelte';
  import StatusDot from './StatusDot.svelte';
  import { Root as Button } from '$lib/components/ui/button/index.js';
  import { Root as Input } from '$lib/components/ui/input/index.js';
  import { Root as Label } from '$lib/components/ui/label/index.js';
  import { cn } from '$lib/utils';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import Server from '@lucide/svelte/icons/server';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import Plus from '@lucide/svelte/icons/plus';

  let url = $state('');
  let name = $state('');
  let username = $state('');
  let password = $state('');
  let token = $state('');
  let authMode = $state<'password' | 'token' | 'none'>('password');
  let showSecret = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let showForm = $state(settings.remotes.length === 0);

  async function connectExisting(id: string) {
    const remote = settings.remotes.find((item) => item.id === id);
    if (!remote) return;
    await app.switchRemote(remote);
    if (app.phase !== 'ready') {
      showForm = true;
      error = app.lastError;
    }
  }

  async function connect() {
    const target = normalizeBaseUrl(url);
    if (!target) {
      error = 'Enter the address of an opencode host.';
      return;
    }
    busy = true;
    error = null;
    const creds =
      authMode === 'token'
        ? { token }
        : authMode === 'password'
          ? { username, password }
          : {};
    const health = await testRemote(target, creds);
    if (health.state === 'offline' || health.state === 'unauthorized') {
      error =
        health.state === 'unauthorized'
          ? 'The host rejected these credentials. Check the username and password.'
          : `${health.error ?? 'Could not reach this host.'} Make sure opencode serve or the tether host is running and reachable.`;
      busy = false;
      return;
    }
    const hostname = (() => {
      try {
        return new URL(target).hostname;
      } catch {
        return target;
      }
    })();
    const remote = settings.addRemote({
      name: name.trim() || hostname,
      url: target,
      ...creds
    });
    await app.switchRemote(remote);
    busy = false;
    if (app.phase !== 'ready') error = app.lastError ?? 'Could not connect.';
  }
</script>

<div class="relative flex min-h-dvh flex-col overflow-y-auto bg-background">
  <div class="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(ellipse_at_top,rgba(250,178,131,0.13),transparent_62%)]"></div>
  <div class="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-background to-transparent"></div>

  <header class="android-safe-top relative z-10 flex items-center justify-between px-4 pb-2 pt-5 sm:px-8">
    <Brand size={34} wordmark tagline />
    <Button variant="ghost" size="sm" class="h-7 gap-1 text-[10px] text-muted-foreground" onclick={() => openExternal(OPENCODE_URL)}>
      opencode.ai
    </Button>
  </header>

  <main class="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-6 sm:px-6 sm:py-10">
    <div class="text-center">
      <div class="mx-auto inline-flex items-center gap-1.5 rounded-full border border-tether/20 bg-tether/[0.06] px-2.5 py-1 text-[9px] font-medium uppercase tracking-[0.14em] text-tether">
        <span class="live-dot size-1.5 rounded-full bg-tether"></span> unofficial · hobby project
      </div>
      <h1 class="mt-4 text-balance text-[28px] font-semibold leading-[1.12] tracking-[-0.03em] sm:text-[34px]">
        Your opencode,<br /><span class="text-tether">tethered.</span>
      </h1>
      <p class="mx-auto mt-2 max-w-sm text-balance text-[12px] leading-relaxed text-muted-foreground">
        A native-feeling remote for the opencode web server. Talk to your agents from your phone, tablet, or desktop — with sessions, tools, permissions, and live output.
      </p>
    </div>

    {#if settings.remotes.length > 0 && !showForm}
      <div class="mt-7 space-y-2">
        <div class="flex items-center justify-between px-1">
          <span class="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/50">Saved hosts</span>
          <button class="text-[10px] text-tether hover:underline" onclick={() => (showForm = true)}>Add another</button>
        </div>
        {#each settings.remotes as remote (remote.id)}
          <button
            type="button"
            class="flex w-full items-center gap-2.5 rounded-xl border border-border/70 bg-card/50 px-3 py-2.5 text-left transition-colors hover:border-tether/30 hover:bg-card/80"
            onclick={() => connectExisting(remote.id)}
          >
            <StatusDot state={remote.id === app.activeRemote?.id ? app.connection.state : 'unknown'} size={8} />
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-1.5 text-[12px] font-semibold">{remote.name}
                {#if settings.defaultRemoteId === remote.id}<span class="rounded bg-tether/10 px-1 py-0 text-[8px] uppercase tracking-wide text-tether">default</span>{/if}
              </span>
              <span class="block truncate font-mono text-[9.5px] text-muted-foreground/60">{remote.url}</span>
            </span>
            <span class="text-[9px] text-muted-foreground/45">{remote.lastUsedAt ? relativeTime(remote.lastUsedAt) : ''}</span>
            <ArrowRight class="size-3.5 text-muted-foreground/40" />
          </button>
        {/each}
      </div>
    {/if}

    {#if showForm}
      <div class="mt-6 rounded-2xl border border-border/70 bg-card/55 p-3.5 shadow-[0_20px_60px_rgba(0,0,0,0.25)] backdrop-blur sm:p-4">
        <div class="flex items-center gap-2">
          <span class="grid size-7 place-items-center rounded-lg border border-border/60 bg-muted/40"><Server class="size-3.5 text-tether" /></span>
          <div>
            <div class="text-[12px] font-semibold">Connect a host</div>
            <div class="text-[9.5px] text-muted-foreground/55">opencode serve or an opencode-tether host</div>
          </div>
        </div>

        <div class="mt-3 space-y-2.5">
          <div class="space-y-1">
            <Label for="onboard-url" class="text-[10px]">Address</Label>
            <Input
              id="onboard-url"
              bind:value={url}
              placeholder="http://127.0.0.1:4096"
              inputmode="url"
              autocapitalize="none"
              spellcheck={false}
              class="h-9 font-mono text-[12px]"
              oninput={() => (error = null)}
            />
          </div>

          <div class="grid grid-cols-3 gap-1 rounded-lg border border-border/60 bg-muted/30 p-0.5">
            {#each [['password', 'Password'], ['token', 'API key'], ['none', 'No auth']] as [value, label]}
              <button
                type="button"
                class={cn('rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors', authMode === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                onclick={() => (authMode = value as typeof authMode)}
              >
                {label}
              </button>
            {/each}
          </div>

          {#if authMode === 'password'}
            <div class="grid grid-cols-2 gap-2">
              <div class="space-y-1">
                <Label for="onboard-user" class="text-[10px]">Username</Label>
                <Input id="onboard-user" bind:value={username} autocapitalize="none" autocomplete="username" class="h-9 text-[12px]" />
              </div>
              <div class="space-y-1">
                <Label for="onboard-pass" class="text-[10px]">Password</Label>
                <div class="relative">
                  <Input id="onboard-pass" bind:value={password} type={showSecret ? 'text' : 'password'} autocomplete="current-password" class="h-9 pr-8 text-[12px]" />
                  <button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onclick={() => (showSecret = !showSecret)} aria-label="Toggle password visibility">
                    {#if showSecret}<EyeOff class="size-3.5" />{:else}<Eye class="size-3.5" />{/if}
                  </button>
                </div>
              </div>
            </div>
          {:else if authMode === 'token'}
            <div class="space-y-1">
              <Label for="onboard-token" class="text-[10px]">API key or bearer token</Label>
              <Input id="onboard-token" bind:value={token} type={showSecret ? 'text' : 'password'} autocapitalize="none" class="h-9 font-mono text-[12px]" />
            </div>
          {/if}

          <div class="space-y-1">
            <Label for="onboard-name" class="text-[10px]">Name <span class="font-normal text-muted-foreground/50">(optional)</span></Label>
            <Input id="onboard-name" bind:value={name} placeholder="Workstation" class="h-9 text-[12px]" />
          </div>

          {#if error}
            <div class="flex items-start gap-1.5 rounded-lg border border-red-500/20 bg-red-500/[0.05] px-2 py-1.5 text-[10px] leading-relaxed text-red-300/90">
              <CircleAlert class="mt-0.5 size-3 shrink-0" /> <span>{error}</span>
            </div>
          {/if}

          <Button class="h-9 w-full gap-1.5 bg-tether text-[12px] font-semibold text-primary-foreground hover:bg-tether/85" onclick={connect} disabled={busy || !url.trim()}>
            {#if busy}<Loader2 class="size-3.5 animate-spin" />{:else}<ArrowRight class="size-3.5" />{/if}
            {busy ? 'Connecting…' : 'Connect'}
          </Button>
          <p class="text-center text-[9px] leading-relaxed text-muted-foreground/45">
            Credentials are saved on this device for quick reconnects.
            {#if settings.remotes.length > 0}<button class="ml-1 text-tether hover:underline" onclick={() => (showForm = false)}>Use a saved host</button>{/if}
          </p>
        </div>
      </div>
    {/if}

    <div class="mx-auto mt-5 flex w-full max-w-sm items-start gap-2 rounded-xl border border-border/50 bg-card/25 px-3 py-2.5">
      <ShieldCheck class="mt-0.5 size-3.5 shrink-0 text-tether/80" />
      <p class="text-[9.5px] leading-relaxed text-muted-foreground/60">
        For remote access, run the <button class="font-medium text-tether hover:underline" onclick={() => openExternal(DOCS_URL)}>opencode-tether host</button> on the machine running opencode. It serves this app and proxies the opencode API behind one login — the recommended setup.
      </p>
    </div>
  </main>

  <footer class="android-safe-bottom relative z-10 px-4 pb-4 text-center text-[8.5px] text-muted-foreground/35">
    opencode-tether is an unofficial, independent hobby project. opencode is a separate project.
  </footer>
</div>
