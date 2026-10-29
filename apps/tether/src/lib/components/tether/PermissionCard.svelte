<script lang="ts">
  import type { PermissionRequest } from '$lib/api/types';
  import { app } from '$lib/state/app.svelte';
  import { Root as Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import ShieldAlert from '@lucide/svelte/icons/shield-alert';
  import Terminal from '@lucide/svelte/icons/terminal';
  import FilePenLine from '@lucide/svelte/icons/file-pen-line';
  import Globe from '@lucide/svelte/icons/globe';
  import Wrench from '@lucide/svelte/icons/wrench';

  let { request, compact = false }: { request: PermissionRequest; compact?: boolean } = $props();
  let working = $state<'once' | 'always' | 'reject' | null>(null);

  const icons: Record<string, typeof Wrench> = { bash: Terminal, edit: FilePenLine, write: FilePenLine, webfetch: Globe, websearch: Globe };
  const Icon = $derived(icons[request.permission] ?? ShieldAlert);
  const command = $derived(
    typeof request.metadata?.command === 'string'
      ? request.metadata.command
      : typeof request.metadata?.filePath === 'string'
        ? request.metadata.filePath
        : typeof request.metadata?.path === 'string'
          ? request.metadata.path
          : typeof request.metadata?.url === 'string'
            ? request.metadata.url
            : ''
  );

  async function reply(value: 'once' | 'always' | 'reject') {
    working = value;
    await app.replyPermission(request.id, value);
    working = null;
  }
</script>

<div class="overflow-hidden rounded-xl border border-amber-500/25 bg-amber-500/[0.055] shadow-[0_10px_40px_rgba(0,0,0,0.16)] backdrop-blur">
  <div class="flex items-start gap-2.5 px-3 py-2.5">
    <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-300">
      <Icon class="size-3.5" />
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-[12px] font-semibold text-amber-100">Permission required</span>
        <Badge variant="outline" class="border-amber-500/25 px-1.5 py-0 text-[9px] text-amber-200/80">{request.permission}</Badge>
      </div>
      <div class="mt-0.5 text-[11px] text-muted-foreground">
        opencode wants to use <span class="font-medium text-foreground/85">{request.permission}</span> in this session.
      </div>
      {#if command}
        <pre class="mt-1.5 max-h-28 overflow-auto rounded-lg border border-border/50 bg-background/40 px-2 py-1.5 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap break-words text-foreground/80">{command}</pre>
      {:else if request.patterns?.length}
        <div class="mt-1.5 flex flex-wrap gap-1">
          {#each request.patterns as pattern}
            <code class="rounded bg-background/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{pattern}</code>
          {/each}
        </div>
      {/if}
      {#if !compact && request.always?.length}
        <div class="mt-1 text-[9px] text-muted-foreground/60">Always allows: {request.always.join(', ')}</div>
      {/if}
    </div>
  </div>
  <div class="flex items-center gap-1.5 border-t border-amber-500/15 bg-background/20 px-3 py-2">
    <Button variant="ghost" size="sm" class="h-7 flex-1 text-[11px] text-muted-foreground" onclick={() => reply('reject')} disabled={!!working}>
      Deny
    </Button>
    <Button variant="outline" size="sm" class="h-7 flex-1 border-border/70 text-[11px]" onclick={() => reply('once')} disabled={!!working}>
      Allow once
    </Button>
    <Button size="sm" class="h-7 flex-1 bg-amber-400/90 text-[11px] text-amber-950 hover:bg-amber-300" onclick={() => reply('always')} disabled={!!working}>
      Always
    </Button>
  </div>
</div>
