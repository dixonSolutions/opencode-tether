<script lang="ts">
  import type { Remote, RemoteHealth } from '$lib/api/types';
  import { settings } from '$lib/state/settings.svelte';
  import { normalizeBaseUrl } from '$lib/api/client';
  import { testRemote } from '$lib/api/health';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Root as Input } from '$lib/components/ui/input/index.js';
  import { Root as Label } from '$lib/components/ui/label/index.js';
  import { Root as Button } from '$lib/components/ui/button/index.js';
  import StatusDot from './StatusDot.svelte';
  import { cn } from '$lib/utils';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Server from '@lucide/svelte/icons/server';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import Check from '@lucide/svelte/icons/check';
  import AlertCircle from '@lucide/svelte/icons/circle-alert';

  let {
    open = $bindable(false),
    remote = null,
    onSaved
  }: { open?: boolean; remote?: Remote | null; onSaved?: (remote: Remote) => void } = $props();

  type AuthMode = 'password' | 'token' | 'none';

  let name = $state('');
  let url = $state('');
  let authMode = $state<AuthMode>('password');
  let username = $state('');
  let password = $state('');
  let token = $state('');
  let showSecret = $state(false);
  let testing = $state(false);
  let testResult = $state<RemoteHealth | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    if (!open) return;
    name = remote?.name ?? '';
    url = remote?.url ?? '';
    username = remote?.username ?? '';
    password = remote?.password ?? '';
    token = remote?.token ?? '';
    authMode = remote?.token ? 'token' : remote?.username || remote?.password ? 'password' : 'password';
    testResult = null;
    error = null;
  });

  function credentials() {
    return authMode === 'token'
      ? { token }
      : authMode === 'password'
        ? { username, password }
        : {};
  }

  async function test(): Promise<boolean> {
    const target = normalizeBaseUrl(url);
    if (!target) {
      error = 'Enter the address of an opencode host.';
      return false;
    }
    testing = true;
    testResult = null;
    error = null;
    try {
      const result = await testRemote(target, credentials());
      testResult = result;
      if (result.state === 'offline' || result.state === 'unauthorized') {
        error = result.error ?? (result.state === 'unauthorized' ? 'The host rejected these credentials.' : 'Could not reach this host.');
        return false;
      }
      return true;
    } finally {
      testing = false;
    }
  }

  async function save(connect: boolean) {
    const target = normalizeBaseUrl(url);
    if (!target) {
      error = 'Enter the address of an opencode host.';
      return;
    }
    const host = (() => {
      try {
        return new URL(target).hostname;
      } catch {
        return target;
      }
    })();
    const finalName = name.trim() || host || 'opencode host';
    const payload = {
      name: finalName,
      url: target,
      username: authMode === 'password' ? username : undefined,
      password: authMode === 'password' ? password : undefined,
      token: authMode === 'token' ? token : undefined
    };
    let saved: Remote;
    if (remote) {
      settings.updateRemote(remote.id, payload);
      saved = { ...remote, ...payload };
    } else {
      saved = settings.addRemote(payload);
    }
    if (connect) settings.touchRemote(saved.id);
    onSaved?.(saved);
    open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[88dvh] overflow-y-auto tether-scroll sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2 text-sm">
        <Server class="size-4 text-tether" /> {remote ? 'Edit host' : 'Add opencode host'}
      </Dialog.Title>
      <Dialog.Description class="text-[11.5px] leading-relaxed text-muted-foreground">
        Connect to an opencode server, or to a machine running the opencode-tether host. Credentials are stored in this app's storage.
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-3">
      <div class="space-y-1.5">
        <Label for="remote-url" class="text-[11px]">Host address</Label>
        <Input
          id="remote-url"
          bind:value={url}
          placeholder="https://workstation.tailnet.ts.net:4096"
          inputmode="url"
          autocapitalize="none"
          spellcheck={false}
          class="h-9 font-mono text-[12px]"
          oninput={() => {
            testResult = null;
            error = null;
          }}
        />
        <p class="text-[9.5px] leading-relaxed text-muted-foreground/60">
          Use the address of <code class="font-mono">opencode serve</code> or an opencode-tether host. HTTP is assumed for localhost and IP addresses.
        </p>
      </div>

      <div class="space-y-1.5">
        <Label for="remote-name" class="text-[11px]">Name <span class="font-normal text-muted-foreground/60">(optional)</span></Label>
        <Input id="remote-name" bind:value={name} placeholder="Workstation" class="h-9 text-[12px]" />
      </div>

      <div class="space-y-1.5">
        <Label class="text-[11px]">Authentication</Label>
        <div class="grid grid-cols-3 gap-1 rounded-lg border border-border/60 bg-muted/30 p-0.5">
          {#each [['password', 'Password'], ['token', 'API key'], ['none', 'None']] as [value, label]}
            <button
              type="button"
              class={cn(
                'rounded-md px-2 py-1.5 text-[10.5px] font-medium transition-colors',
                authMode === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
              onclick={() => {
                authMode = value as AuthMode;
                testResult = null;
              }}
            >
              {label}
            </button>
          {/each}
        </div>
      </div>

      {#if authMode === 'password'}
        <div class="grid grid-cols-2 gap-2">
          <div class="space-y-1.5">
            <Label for="remote-username" class="text-[11px]">Username</Label>
            <Input id="remote-username" bind:value={username} autocapitalize="none" autocomplete="username" class="h-9 text-[12px]" />
          </div>
          <div class="space-y-1.5">
            <Label for="remote-password" class="text-[11px]">Password</Label>
            <div class="relative">
              <Input
                id="remote-password"
                bind:value={password}
                type={showSecret ? 'text' : 'password'}
                autocomplete="current-password"
                class="h-9 pr-8 text-[12px]"
              />
              <button
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onclick={() => (showSecret = !showSecret)}
                aria-label={showSecret ? 'Hide password' : 'Show password'}
              >
                {#if showSecret}<EyeOff class="size-3.5" />{:else}<Eye class="size-3.5" />{/if}
              </button>
            </div>
          </div>
        </div>
      {:else if authMode === 'token'}
        <div class="space-y-1.5">
          <Label for="remote-token" class="text-[11px]">API key or bearer token</Label>
          <Input id="remote-token" bind:value={token} type={showSecret ? 'text' : 'password'} autocapitalize="none" class="h-9 font-mono text-[12px]" />
        </div>
      {/if}

      {#if testResult}
        <div
          class={cn(
            'flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[10.5px]',
            testResult.state === 'offline' || testResult.state === 'unauthorized'
              ? 'border-red-500/20 bg-red-500/[0.05] text-red-300'
              : 'border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-200/90'
          )}
        >
          <StatusDot state={testResult.state} size={7} class="mt-1" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 font-medium">
              {#if testResult.state === 'offline'}
                <AlertCircle class="size-3" /> Unreachable
              {:else if testResult.state === 'unauthorized'}
                <AlertCircle class="size-3" /> Authentication failed
              {:else}
                <Check class="size-3" /> Connected{testResult.version ? ` · opencode ${testResult.version}` : ''}
              {/if}
              {#if testResult.latencyMs}<span class="font-normal opacity-70"> · {testResult.latencyMs}ms</span>{/if}
            </div>
            {#if testResult.error}<div class="mt-0.5 break-words opacity-80">{testResult.error}</div>{/if}
            {#if testResult.busySessions}<div class="mt-0.5 opacity-70">{testResult.busySessions} active session{testResult.busySessions === 1 ? '' : 's'}</div>{/if}
          </div>
        </div>
      {/if}

      {#if error && !testResult}
        <div class="flex items-start gap-1.5 text-[10.5px] text-red-300"><AlertCircle class="mt-0.5 size-3" /> {error}</div>
      {/if}

      <div class="rounded-lg border border-border/50 bg-muted/20 px-2.5 py-2 text-[9.5px] leading-relaxed text-muted-foreground/60">
        Passwords and keys are saved locally for one-tap reconnects. On mobile and desktop they live in the native app store; in a browser they live in local storage. Use the tether host and HTTPS for remote access.
      </div>
    </div>

    <Dialog.Footer class="mt-1 flex-row items-center justify-between gap-2">
      <Button variant="outline" size="sm" class="h-8 text-[11px]" onclick={test} disabled={testing || !url.trim()}>
        {#if testing}<Loader2 class="size-3 animate-spin" />{:else}<StatusDot state={testResult?.state ?? 'unknown'} size={6} />{/if}
        Test connection
      </Button>
      <div class="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" class="h-8 text-[11px]" onclick={() => (open = false)}>Cancel</Button>
        <Button size="sm" class="h-8 text-[11px]" onclick={() => save(true)} disabled={!url.trim()}>Save & connect</Button>
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
