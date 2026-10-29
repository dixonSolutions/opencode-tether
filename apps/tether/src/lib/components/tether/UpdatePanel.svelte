<script lang="ts">
  import { APP_VERSION, FLATPAK_ID, FLATPAKREF_URL, GITHUB_URL, LATEST_RELEASE_API, RELEASES_URL } from '$lib/constants';
  import { copyText, isAndroid, isFlatpak, isTauri, openExternal } from '$lib/platform';
  import { Root as Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { toast } from 'svelte-sonner';
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

  function isNewer(latest: string, current: string): boolean {
    const a = latest.split('.').map((part) => parseInt(part.replace(/\D.*/, ''), 10) || 0);
    const b = current.split('.').map((part) => parseInt(part.replace(/\D.*/, ''), 10) || 0);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
      if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
    }
    return false;
  }

  async function check() {
    checking = true;
    error = null;
    try {
      const res = await fetch(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(res.status === 403 ? 'GitHub rate limit reached. Try again later.' : `GitHub returned ${res.status}.`);
      const data = (await res.json()) as Release;
      release = data;
      latestVersion = cleanVersion(data.tag_name ?? '');
      updateAvailable = isNewer(latestVersion, APP_VERSION);
      if (!updateAvailable) toast.success('You are up to date', { description: `opencode-tether ${APP_VERSION}` });
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not check for updates.';
    } finally {
      checking = false;
    }
  }

  function assetFor(kind: 'apk' | 'flatpak' | 'deb' | 'rpm' | 'appimage'): string | null {
    if (!release) return null;
    const match = release.assets.find((asset) => asset.name.toLowerCase().endsWith(`.${kind}`) || (kind === 'flatpak' && asset.name.toLowerCase().endsWith('.flatpak')));
    return match?.browser_download_url ?? null;
  }

  async function manualInstall() {
    if (!release) return;
    let url: string | null = null;
    if (platform === 'android') url = assetFor('apk');
    else if (platform === 'flatpak') url = assetFor('flatpak') ?? FLATPAKREF_URL;
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

<div class="space-y-3">
  <div class="rounded-xl border border-border/60 bg-card/35 p-3">
    <div class="flex items-start gap-2.5">
      <span class="grid size-8 shrink-0 place-items-center rounded-lg border border-border/60 bg-muted/40 text-tether">
        {#if platform === 'android'}<Smartphone class="size-4" />{:else if platform === 'flatpak'}<Box class="size-4" />{:else if platform === 'desktop'}<Package class="size-4" />{:else}<Terminal class="size-4" />{/if}
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <span class="text-[12px] font-semibold">opencode-tether</span>
          <Badge variant="outline" class="px-1.5 py-0 text-[9px]">v{APP_VERSION}</Badge>
        </div>
        <div class="mt-0.5 text-[10px] text-muted-foreground">{platformLabel}</div>
      </div>
      <Button variant="outline" size="sm" class="h-7 gap-1 text-[10px]" onclick={check} disabled={checking}>
        {#if checking}<Loader2 class="size-3 animate-spin" />{:else}<RefreshCw class="size-3" />{/if}
        Check
      </Button>
    </div>

    {#if updateAvailable}
      <div class="mt-2.5 rounded-lg border border-tether/25 bg-tether/[0.04] px-2.5 py-2">
        <div class="flex items-center gap-1.5 text-[11px] font-medium text-tether">
          <CircleCheck class="size-3.5" /> Version {latestVersion} is available
        </div>
        {#if release?.body}
          <p class="mt-1 line-clamp-4 whitespace-pre-line text-[10px] leading-relaxed text-muted-foreground">{release.body}</p>
        {/if}
                  <Button size="sm" class="mt-2 h-7 gap-1 text-[10.5px]" onclick={manualInstall}>
            <Download class="size-3" />
            {#if platform === 'android'}Download APK{:else if platform === 'flatpak'}Update with Flatpak{:else if platform === 'desktop'}Download package{:else}Download{/if}
          </Button>
      </div>
    {:else if release && !updateAvailable}
      <div class="mt-2.5 flex items-center gap-1.5 text-[10px] text-emerald-300/80">
        <CircleCheck class="size-3" /> You are on the latest version.
      </div>
    {/if}

    {#if error}
      <div class="mt-2 flex items-start gap-1.5 text-[10px] text-red-300/80"><TriangleAlert class="mt-0.5 size-3" /> {error}</div>
    {/if}
  </div>

  {#if platform === 'android'}
    <div class="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3 text-[10px] leading-relaxed text-amber-200/80">
      <div class="font-medium text-amber-100/90">Android updates are manual</div>
      <p class="mt-1 text-muted-foreground">
        Android installs are side-loaded, so the app cannot update itself silently. Download the new APK from GitHub Releases and install it over this app; your saved hosts and settings are kept.
      </p>
      <Button variant="link" size="sm" class="mt-1 h-6 px-0 text-[10px] text-tether" onclick={() => openExternal(RELEASES_URL)}>
        Open releases <ExternalLink class="size-3" />
      </Button>
    </div>
  {:else if platform === 'flatpak'}
    <div class="rounded-xl border border-border/60 bg-card/30 p-3 text-[10px] leading-relaxed text-muted-foreground">
      <div class="font-medium text-foreground/80">Managed by Flatpak</div>
      <p class="mt-1">Flatpak updates flow through the Flatpak portal. Run this in a terminal, or update from GNOME Software / KDE Discover:</p>
      <button type="button" class="mt-1.5 flex w-full items-center justify-between gap-2 rounded-lg border border-border/60 bg-code px-2 py-1.5 font-mono text-[10px] text-foreground/80 hover:border-border" onclick={() => copyCommand(`flatpak update ${FLATPAK_ID}`)}>
        flatpak update {FLATPAK_ID}
        <Copy class="size-3 shrink-0 text-muted-foreground" />
      </button>
      <p class="mt-1.5">To install or refresh the remote build:</p>
      <button type="button" class="mt-1 flex w-full items-center justify-between gap-2 rounded-lg border border-border/60 bg-code px-2 py-1.5 font-mono text-[10px] text-foreground/80 hover:border-border" onclick={() => copyCommand(`flatpak install --from ${FLATPAKREF_URL}`)}>
        <span class="truncate">flatpak install --from …flatpakref</span>
        <Copy class="size-3 shrink-0 text-muted-foreground" />
      </button>
    </div>
  {:else if platform === 'web'}
    <div class="rounded-xl border border-border/60 bg-card/30 p-3 text-[10px] leading-relaxed text-muted-foreground">
      <div class="font-medium text-foreground/80">Host updates</div>
      <p class="mt-1">The host is a Rust service. Update the binary and restart the service:</p>
      <button type="button" class="mt-1.5 flex w-full items-center justify-between gap-2 rounded-lg border border-border/60 bg-code px-2 py-1.5 font-mono text-[10px] text-foreground/80 hover:border-border" onclick={() => copyCommand('sudo opencode-tether update && sudo systemctl restart opencode-tether')}>
        <span class="truncate">sudo opencode-tether update && sudo systemctl restart opencode-tether</span>
        <Copy class="size-3 shrink-0 text-muted-foreground" />
      </button>
      <p class="mt-1.5">Packages are published to the project's APT and DNF repositories on every main-branch release.</p>
    </div>
  {:else if platform === 'desktop'}
    <div class="rounded-xl border border-border/60 bg-card/30 p-3 text-[10px] leading-relaxed text-muted-foreground">
      <div class="font-medium text-foreground/80">Desktop updates</div>
      <p class="mt-1">Download the newer package from GitHub Releases and install it over this build. Flatpak builds are updated through the Flatpak remote.</p>
    </div>
  {/if}

  <div class="flex items-center justify-between px-0.5 text-[9.5px] text-muted-foreground/50">
    <button type="button" class="inline-flex items-center gap-1 hover:text-foreground" onclick={() => openExternal(GITHUB_URL)}>
      <ExternalLink class="size-3" /> GitHub
    </button>
    <span>Main-branch releases · {RELEASES_URL.replace('https://', '')}</span>
  </div>
</div>
