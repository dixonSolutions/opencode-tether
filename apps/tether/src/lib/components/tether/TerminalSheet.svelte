<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { settings } from '$lib/state/settings.svelte';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { cn } from '$lib/utils';
  import { tick } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import TerminalIcon from '@lucide/svelte/icons/terminal';
  import X from '@lucide/svelte/icons/x';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Eraser from '@lucide/svelte/icons/eraser';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let host: HTMLDivElement;
  let term = $state.raw<Terminal | null>(null);
  let fit: FitAddon | null = null;
  let socket: WebSocket | null = null;
  let ptyID: string | null = null;
  let observer: ResizeObserver | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let starting = $state(false);
  let exited = $state(false);
  let error = $state<string | null>(null);
  let startedFor = $state<string | null>(null);
  let ready = $state(false);
  let wasOpen = false;

  const session = $derived(app.selectedSession);
  const title = $derived(session?.title || session?.slug || 'session');

  function isDark(): boolean {
    return settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function termTheme() {
    return isDark()
      ? {
          background: '#0b0a0a',
          foreground: '#f3efec',
          cursor: '#fab283',
          cursorAccent: '#0b0a0a',
          selectionBackground: '#3a2b23',
          black: '#1b1717',
          red: '#f28b82',
          green: '#a8d8a0',
          yellow: '#e6c07b',
          blue: '#8cc8ff',
          magenta: '#d7b0ff',
          cyan: '#8fe3e0',
          white: '#f3efec',
          brightBlack: '#7f7a76',
          brightRed: '#ff9e97',
          brightGreen: '#c2f0b8',
          brightYellow: '#f4d79c',
          brightBlue: '#adddff',
          brightMagenta: '#e8c9ff',
          brightCyan: '#b3f4f1',
          brightWhite: '#ffffff'
        }
      : {
          background: '#faf8f6',
          foreground: '#231e1b',
          cursor: '#b9692f',
          cursorAccent: '#faf8f6',
          selectionBackground: '#f0d6c4',
          black: '#231e1b',
          red: '#b3261e',
          green: '#2d6a2d',
          yellow: '#8a5a00',
          blue: '#1d5fa8',
          magenta: '#7b3fa0',
          cyan: '#0d6b6b',
          white: '#faf8f6',
          brightBlack: '#7b726d',
          brightRed: '#d94b40',
          brightGreen: '#3e8a3e',
          brightYellow: '#a87512',
          brightBlue: '#3579c4',
          brightMagenta: '#9859bf',
          brightCyan: '#1a8a8a',
          brightWhite: '#ffffff'
        };
  }

  $effect(() => {
    if (term) term.options.theme = termTheme();
  });

  $effect(() => {
    if (!open) {
      if (wasOpen) cleanup();
      wasOpen = false;
      return;
    }
    wasOpen = true;
    if (!term && !starting) {
      void start();
    } else {
      requestAnimationFrame(() => fit?.fit());
    }
  });

  async function start() {
    if (!app.client || starting) return;
    starting = true;
    error = null;
    exited = false;
    await tick();
    if (!host) {
      starting = false;
      return;
    }
    try {
      const terminal = new Terminal({
        fontFamily: '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
        fontSize: 12.5,
        lineHeight: 1.25,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 5000,
        convertEol: false,
        theme: termTheme(),
        allowProposedApi: true
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(host);
      fitAddon.fit();
      terminal.focus();
      term = terminal;
      fit = fitAddon;
      startedFor = app.selectedSessionId;
      ready = true;
      terminal.onData((data) => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(data);
      });
      terminal.onResize(({ cols, rows }) => scheduleResize(cols, rows));
      observer = new ResizeObserver(() => {
        fitAddon.fit();
      });
      observer.observe(host);

      const pty = await app.client.post<{ id: string }>(
        '/pty',
        {
          command: '/bin/sh',
          args: [],
          cwd: session?.directory,
          title: `tether · ${title}`,
          env: { TERM: 'xterm-256color' }
        },
        20_000
      );
      ptyID = pty.id;

      let ticket = '';
      try {
        const response = await app.client.raw(`/pty/${pty.id}/connect-token`, {
          method: 'POST',
          headers: { 'x-opencode-ticket': '1' }
        });
        if (response.ok) {
          const data = (await response.json()) as { ticket?: string; data?: { ticket?: string } };
          ticket = data.ticket ?? data.data?.ticket ?? '';
        }
      } catch {
        // Older opencode versions do not have connect tokens; fall back to auth_token.
      }

      const base = app.client.baseUrl.replace(/^http/i, 'ws');
      const params = new URLSearchParams();
      if (session?.directory) params.set('directory', session.directory);
      if (ticket) {
        params.set('ticket', ticket);
      } else if (app.client.auth.username || app.client.auth.password) {
        params.set('auth_token', btoa(`${app.client.auth.username ?? ''}:${app.client.auth.password ?? ''}`));
      }
      const url = `${base}/pty/${pty.id}/connect?${params.toString()}`;
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      socket = ws;
      ws.onopen = () => {
        terminal.writeln(`\x1b[2mopencode-tether · ${title}\x1b[0m`);
        fitAddon.fit();
        scheduleResize(terminal.cols, terminal.rows);
      };
      ws.onmessage = (event) => {
        let data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
        const metadata = data.indexOf('\0');
        if (metadata >= 0) data = data.slice(0, metadata);
        terminal.write(data);
      };
      ws.onerror = () => {
        error = 'Terminal connection failed.';
      };
      ws.onclose = () => {
        if (!exited && !error) terminal.writeln('\r\n\x1b[2m[process exited]\x1b[0m');
        exited = true;
      };
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      term?.writeln(`\r\n\x1b[31m${error}\x1b[0m`);
    } finally {
      starting = false;
    }
  }

  function scheduleResize(cols: number, rows: number) {
    if (!ptyID || !app.client) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      void app.client?.put(`/pty/${ptyID}`, { size: { cols, rows } }).catch(() => undefined);
    }, 120);
  }

  function cleanup() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = null;
    observer?.disconnect();
    observer = null;
    socket?.close();
    socket = null;
    term?.dispose();
    term = null;
    ready = false;
    fit = null;
    startedFor = null;
    if (ptyID && app.client) {
      void app.client.delete(`/pty/${ptyID}`).catch(() => undefined);
    }
    ptyID = null;
  }

  async function restart() {
    cleanup();
    await tick();
    void start();
  }

  function close() {
    open = false;
  }

  function clear() {
    term?.clear();
  }
</script>

<Sheet.Root bind:open>
  <Sheet.Content side="bottom" showCloseButton={false} class="android-safe-bottom h-[78dvh] gap-0 border-t border-border/70 bg-[#0b0a0a] p-0 sm:h-[66dvh]">
    <div class="android-safe-top flex h-11 shrink-0 items-center gap-2 border-b border-white/10 px-3">
      <span class="grid size-6 place-items-center rounded-md bg-tether/10 text-tether"><TerminalIcon class="size-3.5" /></span>
      <span class="min-w-0 flex-1 truncate text-[11.5px] font-semibold">Terminal <span class="font-normal text-muted-foreground/60">· {title}</span></span>
      {#if starting}
        <span class="flex items-center gap-1 text-[9px] text-muted-foreground"><Loader2 class="size-3 animate-spin" /> opening</span>
      {:else if exited}
        <Badge variant="secondary" class="px-1.5 py-0 text-[8.5px] uppercase tracking-wide">exited</Badge>
      {:else if ready}
        <span class="live-dot size-1.5 rounded-full bg-emerald-400"></span>
      {/if}
      <button type="button" class="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground" onclick={restart} title="Restart shell" aria-label="Restart shell">
        <RotateCcw class="size-3.5" />
      </button>
      <button type="button" class="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground" onclick={clear} title="Clear terminal" aria-label="Clear terminal">
        <Eraser class="size-3.5" />
      </button>
      <button type="button" class="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground" onclick={close} title="Close terminal" aria-label="Close terminal">
        <X class="size-4" />
      </button>
    </div>
    {#if error}
      <div class="flex items-center gap-1.5 border-b border-red-500/20 bg-red-500/[0.06] px-3 py-1.5 text-[10px] text-red-300">
        <CircleAlert class="size-3" /> <span class="min-w-0 flex-1 truncate">{error}</span>
        <button class="rounded px-1 py-0.5 underline underline-offset-2 hover:bg-red-500/10" onclick={restart}>retry</button>
      </div>
    {/if}
    <div class="relative min-h-0 flex-1">
      <div bind:this={host} class={cn('h-full w-full overflow-hidden px-1 py-1', starting && 'opacity-50')}></div>
      {#if starting && !term}
        <div class="pointer-events-none absolute inset-0 grid place-items-center text-[10px] text-muted-foreground/60">opening shell…</div>
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>
