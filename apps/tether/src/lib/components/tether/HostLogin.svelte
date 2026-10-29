<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import Brand from './Brand.svelte';
  import { Root as Button } from '$lib/components/ui/button/index.js';
  import { Root as Input } from '$lib/components/ui/input/index.js';
  import { Root as Label } from '$lib/components/ui/label/index.js';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import Lock from '@lucide/svelte/icons/lock';

  let username = $state(app.hostAuth?.username ?? '');
  let password = $state('');
  let showSecret = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function submit() {
    if (!username.trim()) {
      error = 'Enter the host username.';
      return;
    }
    busy = true;
    error = null;
    await app.connectHost(username.trim(), password);
    busy = false;
    if (app.phase !== 'ready') error = app.lastError ?? 'Sign in failed.';
  }
</script>

<div class="relative flex min-h-dvh flex-col overflow-y-auto bg-background">
  <div class="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_top,rgba(250,178,131,0.12),transparent_65%)]"></div>
  <header class="android-safe-top relative z-10 flex items-center justify-between px-4 pb-2 pt-5 sm:px-8">
    <Brand size={32} wordmark tagline />
    <span class="rounded-full border border-tether/20 bg-tether/[0.06] px-2 py-1 text-[8.5px] font-medium uppercase tracking-[0.14em] text-tether">host mode</span>
  </header>

  <main class="relative z-10 mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-8">
    <div class="text-center">
      <span class="mx-auto grid size-11 place-items-center rounded-2xl border border-tether/20 bg-tether/[0.06] text-tether"><Lock class="size-5" /></span>
      <h1 class="mt-3 text-balance text-[22px] font-semibold tracking-[-0.02em]">Sign in to this host</h1>
      <p class="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        This page is served by opencode-tether. Use the host credentials configured on the server.
      </p>
      <div class="mt-2 flex items-center justify-center gap-1.5 text-[9px] text-muted-foreground/50">
        <span class="size-1 rounded-full bg-emerald-400"></span>
        {window.location.host}
        {#if app.host?.upstream.version}<span>· opencode {app.host.upstream.version}</span>{/if}
        {#if app.host?.version}<span>· tether {app.host.version}</span>{/if}
      </div>
    </div>

    <form
      class="mt-5 space-y-2.5 rounded-2xl border border-border/70 bg-card/55 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.25)] backdrop-blur"
      onsubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div class="space-y-1">
        <Label for="host-user" class="text-[10px]">Username</Label>
        <Input id="host-user" bind:value={username} autocapitalize="none" autocomplete="username" class="h-9 text-[12px]" autofocus />
      </div>
      <div class="space-y-1">
        <Label for="host-pass" class="text-[10px]">Password</Label>
        <div class="relative">
          <Input id="host-pass" bind:value={password} type={showSecret ? 'text' : 'password'} autocomplete="current-password" class="h-9 pr-8 text-[12px]" />
          <button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onclick={() => (showSecret = !showSecret)} aria-label="Toggle password visibility">
            {#if showSecret}<EyeOff class="size-3.5" />{:else}<Eye class="size-3.5" />{/if}
          </button>
        </div>
      </div>
      {#if error}
        <div class="flex items-start gap-1.5 rounded-lg border border-red-500/20 bg-red-500/[0.05] px-2 py-1.5 text-[10px] leading-relaxed text-red-300/90">
          <CircleAlert class="mt-0.5 size-3 shrink-0" /> <span>{error}</span>
        </div>
      {/if}
      <Button type="submit" class="h-9 w-full gap-1.5 bg-tether text-[12px] font-semibold text-primary-foreground hover:bg-tether/85" disabled={busy}>
        {#if busy}<Loader2 class="size-3.5 animate-spin" />{:else}<ArrowRight class="size-3.5" />{/if}
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
      <p class="text-center text-[9px] leading-relaxed text-muted-foreground/45">Credentials are stored locally on this device for one-tap access.</p>
    </form>
  </main>

  <footer class="android-safe-bottom relative z-10 px-4 pb-4 text-center text-[8.5px] text-muted-foreground/35">
    opencode-tether · unofficial opencode remote
  </footer>
</div>
