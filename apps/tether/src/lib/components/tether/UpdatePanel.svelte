<script lang="ts">
  import { ANDYSU_HOST_URL, APP_VERSION, FLATPAK_ID, FLATPAKREF_URL, GITHUB_URL, LATEST_RELEASE_API, RELEASES_URL } from '$lib/constants';
  import { compareVersions } from '$lib/api/version';
  import { app } from '$lib/state/app.svelte';
  import { copyText, isAndroid, isFlatpak, isTauri, openExternal } from '$lib/platform';
  import { Root as Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { toast } from 'svelte-sonner';
  import ToggleRow from './ToggleRow.svelte';
  import { assetFor as pickAsset, type AssetKind } from '$lib/release-assets';
  import {
    andysuAvailable,
    andysuMode,
    andysuStatus,
    applyAction,
    applyAndySU,
    canCheck,
    checkAndySU,
    initAndySU,
    setAndySUMode,
    statusText
  } from '$lib/andysu';
  import Download from '@lucide/svelte/icons/download';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Package from '@lucide/svelte/icons/package';
  import Smartphone from '@lucide/svelte/icons/smartphone';
  import Box from '@lucide/svelte/icons/box';
  import Terminal from '@lucide/svelte/icons/terminal';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import Copy from '@lucide/svelte/icons/copy';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  interface Release {
    tag_name: string;
    name?: string;
    body?: string;
    html_url: string;
    published_at?: string;
    assets: Array<{ name: string; browser_download_url: string; size: number }>;
  }

  let checking = $state(false);
  let release = $state<Release | null>(null);
  let latestVersion = $state('');
  let updateAvailable = $state(false);
  let error = $state<string | null>(null);
  let platform = $state<'android' | 'flatpak' | 'desktop' | 'web'>('web');

  // Under an AndySU host the app updates itself, so the GitHub APK updater below stands down: the
  // host's versionName is frozen and it would offer an APK install on every release. Plain builds
  // (sideloaded APK, Flatpak, desktop, web) keep the section they always had.
  const live = andysuAvailable();
  let autoUpdate = $state(true);
  $effect(() => {
    if (!live) return;
    autoUpdate = andysuMode() !== 'off';
    return initAndySU((mode) => (autoUpdate = mode !== 'off'));
  });
  const liveAction = $derived(applyAction($andysuStatus));
  const runningVersion = $derived($andysuStatus.runningVersion);

  $effect(() => {
    void detectPlatform();
  });

  async function detectPlatform() {
    if (await isAndroid()) platform = 'android';
    else if (await isFlatpak()) platform = 'flatpak';
    else if (isTauri()) platform = 'desktop';
    else platform = 'web';
  }

  function cleanVersion(tag: string): string {
    return tag.replace(/^v/, '');
  }

  async function check() {
    checking = true;
    error = null;
    release = null;
    latestVersion = '';
    updateAvailable = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(LATEST_RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: controller.signal
      });
      if (!res.ok) throw new Error(res.status === 403 ? 'GitHub rate limit reached. Try again later.' : `GitHub returned ${res.status}.`);
      const data = (await res.json()) as Release;
      const nextVersion = cleanVersion(data.tag_name ?? '');
      const currentVersion = app.hostMode && app.host?.version ? app.host.version : APP_VERSION;
      const comparison = compareVersions(nextVersion, currentVersion);
      if (comparison === null) throw new Error('GitHub returned an invalid release version.');
      release = data;
      latestVersion = nextVersion;
      updateAvailable = comparison > 0;
      if (!updateAvailable) toast.success('You are up to date', { description: `opencode-tether ${currentVersion}` });
    } catch (err) {
      error = err instanceof Error && err.name === 'AbortError'
        ? 'Update check timed out. Try again.'
        : err instanceof Error ? err.message : 'Could not check for updates.';
    } finally {
      clearTimeout(timeout);
      checking = false;
    }
  }

  function assetFor(kind: AssetKind): string | null {
    return release ? pickAsset(release.assets, kind) : null;
  }

  async function manualInstall() {
    if (!release) return;
    if (platform === 'flatpak') {
      await copyCommand(`flatpak update ${FLATPAK_ID}`);
      return;
    }
    let url: string | null = null;
    if (platform === 'android') url = assetFor('apk');
    else if (platform === 'desktop') url = assetFor('appimage') ?? (assetFor('deb') ?? assetFor('rpm'));
    if (!url) {
      await openExternal(release.html_url);
      return;
    }
    await openExternal(url);
    toast.info('Download started', { description: platform === 'android' ? 'Open the APK to install the update manually.' : 'Install the downloaded package to update.' });
  }

  async function copyCommand(command: string) {
    const ok = await copyText(command);
    toast[ok ? 'success' : 'error'](ok ? 'Command copied' : 'Could not copy');
  }

  const platformLabel = $derived(
    platform === 'android' ? 'Android app' : platform === 'flatpak' ? 'Flatpak' : platform === 'desktop' ? 'Desktop app' : 'Web / host'
  );
</script>

{#if live}
  <div class="space-y-3">
    <div class="rounded-xl border border-border/60 bg-card/35 p-3">
      <div class="flex items-start gap-2.5">
        <span class="grid size-11 shrink-0 place-items-center rounded-xl border border-border/60 bg-muted/40 text-tether"><Smartphone class="size-5" /></span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <span class="text-sm font-semibold">opencode-tether</span>
            {#if runningVersion}<Badge variant="outline" class="px-2 py-0.5 text-[11px]" data-testid="running-version">v{runningVersion}</Badge>{/if}
          </div>
          <div class="mt-1 text-xs text-muted-foreground">Android app · updates itself</div>
        </div>
      </div>
      <p class="mt-3 text-sm" role="status" data-testid="update-status">{statusText($andysuStatus)}</p>
      <div class="mt-3 flex flex-wrap gap-2">
        {#if liveAction}
          <Button size="sm" class="h-10 gap-1.5 text-sm" onclick={applyAndySU}>{liveAction}</Button>
        {/if}
        <Button variant="outline" size="sm" class="h-10 gap-1.5 text-sm" disabled={!canCheck($andysuStatus)} onclick={checkAndySU}>
          <RefreshCw class="size-4" /> Check now
        </Button>
      </div>
      <ToggleRow
        label="Update automatically"
        description="Check on open and hourly. UI updates reload live; native changes apply automatically (screen may reload)."
        bind:checked={autoUpdate}
        onChange={(value) => setAndySUMode(value ? 'auto' : 'off')}
      />
    </div>
    <div class="flex items-center justify-between px-0.5 text-xs text-muted-foreground/50">
      <button type="button" class="inline-flex items-center gap-1 hover:text-foreground" onclick={() => openExternal(GITHUB_URL)}>
        <ExternalLink class="size-4" /> GitHub
      </button>
    </div>
  </div>
{:else}
<div class="space-y-3">
  <div class="rounded-xl border border-border/60 bg-card/35 p-3">
    <div class="flex items-start gap-2.5">
      <span class="grid size-11 shrink-0 place-items-center rounded-xl border border-border/60 bg-muted/40 text-tether">
        {#if platform === 'android'}<Smartphone class="size-5" />{:else if platform === 'flatpak'}<Box class="size-5" />{:else if platform === 'desktop'}<Package class="size-5" />{:else}<Terminal class="size-5" />{/if}
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <span class="text-sm font-semibold">opencode-tether</span>
          <Badge variant="outline" class="px-2 py-0.5 text-[11px]">v{APP_VERSION}</Badge>
        </div>
        <div class="mt-1 text-xs text-muted-foreground">{platformLabel}</div>
      </div>
      <Button variant="outline" size="sm" class="h-10 gap-1.5 text-sm" onclick={check} disabled={checking}>
        {#if checking}<Loader2 class="size-4 animate-spin" />{:else}<RefreshCw class="size-4" />{/if}
        Check
      </Button>
    </div>

    {#if updateAvailable}
      <div class="mt-2.5 rounded-lg border border-tether/25 bg-tether/[0.04] px-2.5 py-2">
        <div class="flex items-center gap-2 text-sm font-medium text-tether">
          <CircleCheck class="size-4" /> Version {latestVersion} is available
        </div>
        {#if release?.body}
          <p class="mt-1.5 line-clamp-5 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{release.body}</p>
        {/if}
        <Button size="sm" class="mt-3 h-10 gap-1.5 text-sm" onclick={manualInstall}>
          {#if platform === 'flatpak'}<Copy class="size-4" />{:else}<Download class="size-4" />{/if}
          {#if platform === 'android'}Download APK{:else if platform === 'flatpak'}Copy update command{:else if platform === 'desktop'}Download package{:else}Download{/if}
        </Button>
      </div>
    {:else if release && !updateAvailable}
      <div class="mt-3 flex items-center gap-2 text-xs text-emerald-300/80">
        <CircleCheck class="size-4" /> You are on the latest version.
      </div>
    {/if}

    {#if error}
      <div class="mt-2 flex items-start gap-2 text-xs text-red-300/80"><TriangleAlert class="mt-0.5 size-4" /> {error}</div>
    {/if}
  </div>

  {#if platform === 'android'}
    <div class="rounded-xl border border-tether/25 bg-tether/[0.04] p-3.5 text-xs leading-relaxed text-foreground/80">
      <div class="font-medium text-tether">Automatic updates with AndySU</div>
      <p class="mt-1 text-muted-foreground">
        Install the signed AndySU host once on Android 11+ (arm64). After that, opencode-tether checks and downloads updates automatically; UI updates apply live, native updates apply with a quick automatic relaunch. Your hosts, sessions, drafts and settings are kept.
      </p>
      <Button size="sm" class="mt-2.5 h-10 gap-1.5 text-sm" onclick={() => openExternal(ANDYSU_HOST_URL)}>
        <Download class="size-4" /> Install AndySU host
      </Button>
      <p class="mt-2 text-muted-foreground/60">
        Older Android or another ABI?
        <button type="button" class="text-tether underline underline-offset-2" onclick={() => openExternal(RELEASES_URL)}>Use the manual APK</button>.
      </p>
    </div>
  {:else if platform === 'flatpak'}
    <div class="rounded-xl border border-border/60 bg-card/30 p-3.5 text-xs leading-relaxed text-muted-foreground">
      <div class="font-medium text-foreground/80">Managed by Flatpak</div>
      <p class="mt-1">Flatpak updates flow through the Flatpak portal. Run this in a terminal, or update from GNOME Software / KDE Discover:</p>
      <button type="button" class="mt-2 flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-border/60 bg-code px-3 py-2 font-mono text-xs text-foreground/80 hover:border-border" onclick={() => copyCommand(`flatpak update ${FLATPAK_ID}`)}>
        flatpak update {FLATPAK_ID}
        <Copy class="size-4 shrink-0 text-muted-foreground" />
      </button>
      <p class="mt-1.5">To install or refresh the remote build:</p>
      <button type="button" class="mt-1.5 flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-border/60 bg-code px-3 py-2 font-mono text-xs text-foreground/80 hover:border-border" onclick={() => copyCommand(`flatpak install --from ${FLATPAKREF_URL}`)}>
        <span class="truncate">flatpak install --from …flatpakref</span>
        <Copy class="size-4 shrink-0 text-muted-foreground" />
      </button>
    </div>
  {:else if platform === 'web'}
    <div class="rounded-xl border border-border/60 bg-card/30 p-3.5 text-xs leading-relaxed text-muted-foreground">
      <div class="font-medium text-foreground/80">Host updates</div>
      <p class="mt-1">The host is a Rust service. Update the binary and restart the service:</p>
      <button type="button" class="mt-2 flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-border/60 bg-code px-3 py-2 font-mono text-xs text-foreground/80 hover:border-border" onclick={() => copyCommand('sudo opencode-tether update && sudo systemctl restart opencode-tether')}>
        <span class="truncate">sudo opencode-tether update && sudo systemctl restart opencode-tether</span>
        <Copy class="size-4 shrink-0 text-muted-foreground" />
      </button>
      <p class="mt-1.5">Packages are published to the project's APT and DNF repositories on every main-branch release.</p>
    </div>
  {:else if platform === 'desktop'}
    <div class="rounded-xl border border-border/60 bg-card/30 p-3.5 text-xs leading-relaxed text-muted-foreground">
      <div class="font-medium text-foreground/80">Desktop updates</div>
      <p class="mt-1">Download the newer package from GitHub Releases and install it over this build. Flatpak builds are updated through the Flatpak remote.</p>
    </div>
  {/if}

  <div class="flex items-center justify-between px-0.5 text-xs text-muted-foreground/50">
    <button type="button" class="inline-flex items-center gap-1 hover:text-foreground" onclick={() => openExternal(GITHUB_URL)}>
      <ExternalLink class="size-4" /> GitHub
    </button>
    <span>Main-branch releases · {RELEASES_URL.replace('https://', '')}</span>
  </div>
</div>

{/if}
